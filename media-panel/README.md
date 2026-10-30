# Painel de mídias

Aplicação desktop (Tauri + React) para listar as pastas de jogo na raiz do bucket S3 e enviar branding, screenshots e clips.

## Configuração

1. Copie `.env.example` para `.env`.
2. Preencha `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` e `AWS_S3_BUCKET`.

As credenciais são lidas apenas no backend Rust a partir do `.env`. Não use prefixo `VITE_`.

## Desenvolvimento

```bash
cd media-panel
npm install
npm run tauri dev
```

Na raiz do repositório: `npm run panel:dev`.

## Executável

```bash
cd media-panel
npm run build:exe
```

Na raiz: `npm run panel:build`. O Tauri gera o `.exe` em `src-tauri/target/release/` e os instaladores em `src-tauri/target/release/bundle/` (NSIS/MSI no Windows). Exige Rust (`rustup`) e as ferramentas de build da plataforma.

O frontend também pode ser aberto com `npm run dev` (http://localhost:1420). Nesse modo o Vite usa `@aws-sdk/client-s3` para listar e enviar arquivos. O binário Tauri usa o mesmo bucket no backend Rust.

Para só conferir as pastas da raiz:

```bash
npm run list:games
```

No Linux, o `tauri dev` exige os pacotes de desenvolvimento do WebKit/GTK (`libwebkit2gtk-4.1-dev`, `librsvg2-dev`, `libglib2.0-dev`).

Os jogos listados são as chaves de pasta da raiz do bucket (`ListObjectsV2` com `Delimiter=/`), não o `games.json`.

## Cache

O painel grava o catálogo e as imagens em `media-panel/.cache/` (TTL indefinido, como a biblioteca web). Na próxima execução as capas e metadados saem do disco; o S3 só é consultado de novo ao clicar em **Atualizar** ou após um upload.
