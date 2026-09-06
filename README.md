# ZTA MCP Gateway (Zero Trust Architecture MCP Gateway)

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![MCP](https://img.shields.io/badge/MCP-2026.7_Compliant-green.svg)](https://modelcontextprotocol.io/)
[![Zero Trust](https://img.shields.io/badge/Security-ZTA_Compliant-orange.svg)](#)

**ZTA MCP Gateway** は、Model Context Protocol (MCP) サーバーのための **ゼロトラスト・リバースプロキシ型セキュリティゲートウェイ** です。  
AIエージェント（LLM）とMCPサーバー（MariaDB公式MCP、Docker Monitor MCP等）の間に配置することで、**「AIの視界マスキング（認可外ツールの非公開）」**、**「SQL/引数ファイアウォール（破壊的クエリの遮断）」**、**「マルチクラウド対応のプラガブル鍵管理」** を提供し、安全なAIエージェント運用を実現します。

---

## 📌 開発の背景と解決する課題

### 1. サードパーティMCPサーバーの認可欠落（Confused Deputy問題）
- **現状の課題**:  
  MariaDB公式MCPサーバーをはじめとする多くのMCPサーバーは、「すべてのツール（テーブル参照・更新・削除）が単一のエンドポイントで公開」されており、ユーザーやAIエージェントのロールに応じたツール単位のきめ細かいアクセス制御ができません。
- **発生するリスク**:  
  「売上データのみを参照させたい」一般ユーザーのプロンプトであっても、AIエージェントは `write_query` や `drop_table` などの危険なツールを認識し、自律的に探索や意図しない更新・削除を実行してしまう恐れ（Confused Deputy問題）があります。

### 2. クラウドベンダーロックインの回避
- AWSのSecrets Manager / KMSのみに依存すると、オンプレミス、さくらのVPS、GCP、Kubernetes環境などを利用する企業で導入障壁となります。
- 本ゲートウェイは **完全コンテナ化されたポータブル設計** とし、暗号鍵やクレデンシャルの保管先を「Local」「GCP」「AWS」「GitHub」「Vault」から柔軟に切り替えられる設計を採用しています。

### 3. アタックサーフェス最小化のための「ヘッドレス」設計
- セキュリティ中継地点であるゲートウェイ自身に管理用Web UIを持たせると、Webアプリケーション脆弱性（XSS, CSRF, セッションハイジャック）のリスクが生じます。
- ゲートウェイ本体は **完全ヘッドレス（Headless Core）** とし、設定はYAMLファイル駆動、または上位システム（MacOSUI等）のコントロールプレーンから安全に配信します。

---

## 🛡️ 主な特徴とセキュリティ機構

```mermaid
flowchart TD
    subgraph AI Client
        Client[MacOSUI / Claude Desktop / Custom Agent]
    end

    subgraph ZTA MCP Gateway [ZTA MCP Gateway (Headless Reverse Proxy)]
        Auth[1. OAuth 2.1 Token Verifier<br/>ロール / スコープ / クライアント識別]
        Masking[2. Context Masking PEP<br/>tools/list から未許可ツールを消去]
        Firewall[3. Query Firewall PEP<br/>tools/call の引数・SQL AST構文解析]
        Audit[4. Audit Logging Engine<br/>構造化JSONで全リクエスト/判定を記録]
        SecretMgr[5. Pluggable Secret Provider<br/>Local / GCP / AWS / GitHub / Vault]
    end

    subgraph Upstream MCP Servers
        MariaDB[MariaDB Official MCP Server]
        Docker[Docker Monitor MCP Server]
        Other[Other External MCP Servers]
    end

    Client -->|OAuth 2.1 Bearer Token| Auth
    Auth --> Masking
    Auth --> Firewall
    Masking -->|Sanitized tools/list| Client
    Firewall -->|Allow / Forward| MariaDB
    Firewall -->|Allow / Forward| Docker
    Firewall -->|Allow / Forward| Other
    Firewall -.->|Block 403 Forbidden| Client
    Firewall -.-> Audit
    SecretMgr -.->|Credentials Injection| Firewall
```

### 1. Context Masking（AI視界マスキング）
AIエージェントが `tools/list` を呼び出した際、トークンに含まれるロール（例: `viewer`, `readonly-analyst`）を評価し、**認可されていないツール（更新系ツール、危険なコマンド）を一覧から完全に削除**して返却します。  
AIはそもそもツールの存在を認識できないため、ハルシネーションや探索的悪用が根本から防止されます。

### 2. Query Firewall（実行時SQL構文解析・PEP）
万が一AIが `tools/call` を推測して直接呼び出した場合でも、SQLパーサーによるAST（抽象構文木）解析を実施。
- `SELECT` 以外の `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `TRUNCATE` を検知
- セミコロンによる多重クエリ（`SELECT 1; DROP TABLE users;` 等）を検知
- 不正が検出された場合は上流MCPサーバーにパケットを渡さず、即座に `403 Forbidden` を返却

### 3. プラガブル・シークレット・プロバイダ (`ISecretProvider`)
以下の暗号鍵・シークレット管理プロバイダを環境変数1つで切り替え可能：
- `local`: AES-256-GCM暗号化ファイル / 環境変数（オンプレミス・開発環境向け）
- `gcp`: Google Cloud Secret Manager / Cloud KMS
- `aws`: AWS Secrets Manager / AWS KMS
- `github`: GitHub Secrets API（CI/CD・GitHub Actions統合向け）
- `vault`: HashiCorp Vault / OpenBao（プライベートクラウド・金融系向け）

### 4. 2026年7月 MCP最新仕様への完全準拠
- **Stateless Core**: セッション状態を持たず、水平スケール可能なステートレス設計
- **OAuth 2.1 M2M**: JWTを用いた厳格なマシン間（A2A / Agent-to-Agent）認証
- **SSE Transport**: `GET /sse` および `POST /message` による堅牢なイベント駆動通信

---

## 📁 ディレクトリ構成

```text
zta-mcp-gateway/
├── README.md                           # 本ドキュメント
├── package.json                        # パッケージ設定
├── config/
│   └── gateway-config.example.yaml     # ゲートウェイ設定サンプル (MariaDB, Docker等)
├── docs/
│   ├── SPECIFICATION.md                # 詳細仕様書 (アーキテクチャ・PEP・プロバイダ仕様)
│   └── ARCHITECTURE.md                 # アーキテクチャ図とデータフロー
└── src/                                # 実装ソースコード (Phase 2で開発)
    ├── index.ts                        # サーバーエントリーポイント
    ├── auth/                           # OAuth 2.1 / JWT 検証
    ├── pep/                            # Policy Enforcement Point (Masking & Firewall)
    ├── proxy/                          # リバースプロキシ・SSE通信層
    ├── secrets/                        # プラガブル鍵管理 (Local/GCP/AWS/Vault/GitHub)
    └── audit/                          # 構造化監査ログ出力
```

---

## 🚀 設定例 (`config/gateway-config.yaml`)

```yaml
version: "1.0"
server:
  port: 8080
  cors:
    origin: "*"

# プラガブル鍵管理の指定
secrets:
  provider: "local" # local | gcp | aws | github | vault
  local:
    key_file: "./keys/master.key"

# 上流MCPサーバーのルーティングとZTAポリシー定義
upstreams:
  # 1. MariaDB 公式 MCP サーバーの保護設定
  - id: "mariadb-upstream"
    path: "/mcp/mariadb"
    target: "http://localhost:33060/sse"
    policies:
      # ロールごとのツール認可 (Context Masking)
      role_mappings:
        analyst:
          allowed_tools:
            - "read_query"
            - "list_tables"
            - "describe_table"
        dba_admin:
          allowed_tools:
            - "*"
      # 実行時クエリファイアウォール (Query Firewall)
      firewall:
        enforce_sql_check: true
        restricted_roles:
          - "analyst"
        allowed_statements:
          - "SELECT"
        deny_statements:
          - "INSERT"
          - "UPDATE"
          - "DELETE"
          - "DROP"
          - "ALTER"
          - "TRUNCATE"
```

---

## 📄 詳細仕様書
より詳細なシステム要件、インターフェース定義、セキュリティ監査ログの仕様については、[docs/SPECIFICATION.md](docs/SPECIFICATION.md) をご覧ください。

---

## 📜 ライセンス
Apache License 2.0
