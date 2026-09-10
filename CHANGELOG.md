# Changelog

本プロジェクトのすべての主要な変更履歴は本ファイルに記録されます。
フォーマットは [Keep a Changelog](https://keepachangelog.com/ja/1.0.0/) に準拠し、バージョン番号は [セマンティック バージョニング](https://semver.org/lang/ja/) に従います。

---

## [v0.2.0] - 2026-09-10

### 🚀 Meta-Catalog MCP & SSE Keepalive Engine

#### ✨ Added (新機能・機能追加)
- **📚 Meta-Catalog MCP（DBメタ情報 & GenUI 設計図プロバイダー）**:
  - `list_catalog`: ロール権限に基づき、アクセス可能なデータモデル（テーブル・ビュー・分析ドメイン）の概要一覧を返却。
  - `get_catalog_detail`: 指定したカタログ項目のスキーマ構造（カラム定義、データ型、PK/FKリレーション、NULL許可、インデックス）および推奨 GenUI 仕様（Chart.js スペック、インタラクティブ詳細カード、レイアウト、KPI 指標、AI インサイトバナー）を一元提供。
  - **Context Masking**: PDP（ポリシー決定点）に定義されたロール情報に基づき、権限のないカラムや項目を動的にマスク・除外。
  - **YAML-Driven 構成**: 外部 YAML ファイル（`config/catalog-definitions.yaml`）により、コード変更不要で新しいデータモデルや GenUI テンプレートを即座に追加・拡張可能。
- **🔌 仮想 MCP SSE トランスポートエンドポイント (`/mcp/catalog/sse`)**:
  - アップストリームサーバーを別途立ち上げることなく、ゲートウェイ自身が仮想 MCP サーバーとしてクライアント（MacOSUI 等）と直接 SSE および JSON-RPC 2.0 で通信。
- **🛡️ SQL ファイアウォール許可ステートメントの拡張**:
  - ホワイトリストに `SHOW` および `DESC` ステートメントを追加し、データ探索時の安全な実行をサポート。
- **💓 SSE Keepalive ハートビート機構**:
  - SSE コネクションに対して 15 秒間隔で空行コメント（`: keepalive\n\n`）を送信し、ロードバランサーやリバースプロキシによるアイドルタイムアウト切断を防止。

---

## [v0.1.0] - 2026-09-02

### 🚀 Initial Release of ZTA-MCP-Gateway

#### ✨ Added (新機能・機能追加)
- **🛡️ Zero Trust Architecture (ZTA) リバースプロキシ型 MCP ゲートウェイ**:
  - Model Context Protocol (MCP) 通信を仲介し、最小権限の原則（Least Privilege）を強制。
- **🔐 Agent-to-Agent (A2A) OAuth 2.1 認証 & JWT トークン交換 (`POST /token`)**:
  - クライアントクレデンシャルを用いた暗号化 JWT トークンの発行・検証・サイレントリフレッシュ。
- **⚖️ Dynamic PDP / PEP 認可制御**:
  - トークン内のロールに基づき、利用可能な MCP ツール（`allowed_tools`）を厳格にフィルタリング。
- **🧱 SQL AST ファイアウォール**:
  - データベースクエリを AST 解析し、DROP/TRUNCATE/DELETE などの危険な構文を遮断。
- **📈 監査ログ & レートリミット**:
  - 全 MCP ツール実行の追跡記録、および IP / クライアント単位でのリクエスト流量制御。
