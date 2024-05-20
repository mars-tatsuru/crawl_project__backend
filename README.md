## Crawl project

Crawlee を利用したサイトクロールバックエンド環境。

## 使用技術など

- node v.16
- "typescript": "^5.4.5"
- "fastify": "^4.27.0"
- docker

## Start without Docker

### 1.下記コマンド実行

```
npm start
```

これで node の環境が[localhost:8000](http://0.0.0.0:8000/)で立ち上がります。file 変更も同時に監視していますので、hotreload できています。

## Start with Docker

### 1.docker の立ち上げをします。

```
docker-compose up -d
```

<br />

### 2.bash へアクセス

```
 docker exec -it node-api bash
```

※下記コマンドを実行したら、"/test called"と表示されるか確認する。

<br />

### 3.ブラウザで確認

http://localhost:8001/test へアクセスし、ブラウザに"/test called"と表示されているか確認
