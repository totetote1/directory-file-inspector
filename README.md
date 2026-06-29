# Directory File Inspector

ローカルディレクトリ内のファイルを調査し、サイズ・名前・ファイルタイプ・更新日時で並び替えできるNode.js製のローカルWebアプリです。

削除や移動は行わず、読み取り専用でファイル一覧と集計を作成します。

## Features

- 指定ディレクトリ配下のファイル一覧作成
- ファイルサイズ、名前、ファイルタイプ、更新日時でソート
- ファイル名・拡張子・パス検索
- タイプ別/拡張子別の件数と容量集計
- 任意で、同一サイズのファイルだけSHA-256で重複確認
- CSVエクスポート

## 起動

```bash
git clone https://github.com/totetote1/directory-file-inspector.git
cd directory-file-inspector
node server.js
```

ブラウザで `http://127.0.0.1:5178` を開きます。

## ローカルで直接使う場合

```bash
cd /Users/admin011/Desktop/codex/unlinked-file-auditor
node server.js
```

## 重複チェックについて

通常スキャンではファイルの中身を読み込まず、一覧と集計だけを作成します。

「重複も調べる」をONにした場合だけ、同じサイズのファイルに対してSHA-256を計算し、内容が一致するファイルを重複として表示します。大きなディレクトリでは時間がかかるため、まずはOFFで確認するのがおすすめです。

## 除外されるディレクトリ

デフォルトでは以下をスキップします。

- `.git`
- `node_modules`
- `.DS_Store`
- `__MACOSX`

## CSV出力

スキャン後にCSV保存できます。出力列は以下です。

- `path`
- `name`
- `dir`
- `ext`
- `type`
- `size`
- `modified`
- `created`
- `sha256`

## 注意

このツールはローカルPC内のディレクトリを対象にします。外部サイトを探索する機能はありません。
