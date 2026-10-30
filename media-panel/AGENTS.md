# AGENTS.md — media-panel

Subprojeto **independente** da biblioteca web em `src/` (Game Vault). Este diretório é o painel desktop de gerenciamento do bucket S3: listar pastas de jogo, enviar branding/screenshots/clips, sincronizar a pasta local `media/` e gravar `metadata.json`.

Não misture rotas, cache, UI nem serviços do client (`src/pages`, `src/services`, `src/config/mediaConfig.ts`) com o painel. O contrato compartilhado é só o **layout do bucket**.

## O que este projeto é

- UI React em `media-panel/src/`
- Dois backends para o **mesmo** bucket:
  - `npm run dev` (http://localhost:1420): plugin Vite em `vite.config.ts` + `server/*.ts` (`@aws-sdk/client-s3`)
  - `npm run tauri dev` / `npm run panel:dev` na raiz: comandos Tauri em `src-tauri/src/` (Rust)
- O frontend escolhe o caminho em `src/api.ts` (`isTauri()` → `invoke`, senão `fetch /api/...`)

Mudança de listagem, upload ou `metadata.json` precisa ser aplicada nos **dois** backends (`server/s3.ts` e `src-tauri/src/s3.rs`), salvo quando a operação só existe no Vite (SteamGridDB, pasta local, ffmpeg).

## Janela

Janela **fixa 1024×768**, não redimensionável e sem maximizar (`src-tauri/tauri.conf.json` e `src-tauri/src/lib.rs`). Sem barra nativa do SO (`decorations: false`). A barra customizada é `TitleBar` (arrastar, minimizar, fechar). O miolo (`.shell`) preenche o restante com `100%` da webview — não fixe `.shell` nem `.main` em 1024×768, senão a barra e a borda do sistema cortam o conteúdo. Não introduza layouts fluidos de desktop amplo.

## Bucket (contrato com o client)

O painel **lista jogos pelas pastas da raiz** (`ListObjectsV2` com `Delimiter=/`), não pelo `games.json`. O manifest é usado pelo client, não como fonte da lista daqui.

```
<bucket>/<Nome do Jogo>/
  cover.jpg       # capa (obrigatório o nome; não há fallback .png/.webp)
  banner.jpg
  icon.png
  metadata.json   # catálogo de screenshots e clips para o client
  images/         # .jpg (upload .jpeg → .jpg) ou .png
  videos/<clip>/<clip>.mp4
  videos/<clip>/thumb.jpg
```

URL pública padrão: `AWS_S3_PUBLIC_BASE_URL` no `.env` (mesmo bucket da biblioteca).

Nomes de pasta: sem `\ / : * ? " < > |`. Criar jogo gera `images/` e `videos/` vazios e um `metadata.json` vazio. Remover jogo só é permitido sem screenshots nem clips; `metadata.json` e branding canônico não bloqueiam a exclusão.

## metadata.json

Arquivo crítico para o client. Formato:

```json
{
  "images": ["https://…/<Jogo>/images/shot.jpg"],
  "videos": [{ "url": "https://…/<Jogo>/videos/<clip>/<clip>.mp4", "thumb": "https://…/<Jogo>/videos/<clip>/thumb.jpg" }]
}
```

A montagem fica em `server/gameMetadata.ts` (`buildGameMetadata`, `listingFromObjectKeys`, `serializeGameMetadata`). O sync local (`server/prepareMedia.ts`) e os writes no S3 devem reutilizar isso. O equivalente Rust está em `src-tauri/src/s3.rs`.

Ao abrir um jogo, a barra de detalhes mostra se o jogo tem `metadata.json` no bucket (**metadata.json** / **Sem metadata.json**). Cada screenshot/clip da listagem usa cor de fundo e ícone conforme o vínculo com esse arquivo. O botão **Metadata** abre o JSON atual; **Gerar metadata.json** nessa tela regrava o arquivo e recarrega os detalhes.

Regenerar no S3:

- automaticamente após upload de **image** ou **video** (não após capa/banner/ícone)
- ao criar o jogo (JSON vazio)
- no botão **Gerar metadata.json** (`GET/POST /api/games/:nome/metadata` ou comandos `get_game_metadata` / `refresh_game_metadata`)

Capa, banner e ícone **não** entram no JSON. Clips soltos em `videos/*.mp4` não entram até estarem em `videos/<nome>/<nome>.mp4`.

Renomear jogo: botão direito na lista da esquerda → **Renomear**. Move a pasta no bucket (`PATCH /api/games/:nome` `{ name }` ou comando `rename_game`), atualiza o rótulo `Jogo` nos nomes padronizados `YYYY-MM-DDTHHmmssZ_Jogo#n` e regenera `metadata.json`. Cópia S3 com `MetadataDirective=COPY`.

Remoção de jogo: botão direito na lista da esquerda. Só é permitido sem screenshots nem clips. Remoção de screenshot/clip: botão direito na linha da listagem (não há ícone de lixeira visível). Em seguida `DELETE /api/games/:nome/file?key=…` ou comando `delete_media`. Só aceita keys em `images/` ou `videos/`. Clip em pasta apaga a pasta inteira (`mp4` + `thumb.jpg`). Depois o painel regenera `metadata.json`. **Nunca** apague pelo frontend sem a janela de confirmação.

Alterar data de screenshot/clip: botão direito → **Alterar data**. Atualiza só o prefixo `YYYY-MM-DDTHHmmssZ` no nome (e a pasta do clip). Cópia S3 com `MetadataDirective=COPY` — não reescreve metadata do objeto. `PATCH /api/games/:nome/file` `{ key, date }` ou comando `update_media_date`. Depois o painel regenera `metadata.json` por causa das URLs novas.

A listagem de imagens e vídeos mostra a inserção a partir do `LastModified` do objeto no S3. A data original do arquivo fica no nome (`YYYY-MM-DDTHHmmssZ_Jogo#n`, UTC a partir da coluna Data do Explorer).

Upload de screenshot/clip (botão ou arraste, um ou vários arquivos): o painel mostra o nome final `YYYY-MM-DDTHHmmssZ_Jogo#n.ext` (UTC + sequência) e só envia depois da confirmação. Capa, banner e ícone não usam esse padrão.

## Dois runtimes

| Área | Vite (`server/`) | Tauri (`src-tauri/src/`) |
| --- | --- | --- |
| Catálogo, get, upload, CRUD, metadata | `s3.ts` | `s3.rs` + `lib.rs` |
| Cache disco | `cache.ts` → `media-panel/.cache/` | `cache.rs` |
| SteamGridDB | `steamgrid.ts` | não (sempre HTTP `/api/steamgrid…` no Vite) |
| Pasta local + `aws s3 sync` | `localMedia.ts` + `prepareMedia.ts` | não |
| Miniaturas de vídeo (ffmpeg) | `prepareMedia.ts` | não |

No navegador, capas passam por `/api/asset?key=…` (cache local). No Tauri, as URLs públicas do bucket são usadas direto.

## Pasta local

`server/localMedia.ts` aponta para `../media` (raiz do repo, no `.gitignore` da biblioteca). O sync: (1) padroniza nomes `YYYY-MM-DDTHHmmssZ_Jogo#n.ext` (UTC + sequência) em `images/` e clips, move clips para subpastas, gera `thumb.jpg` com ffmpeg, grava `metadata.json`; (2) `aws s3 sync` da pasta inteira. Exige AWS CLI e ffmpeg no PATH.

## Frontend

Entrada: `src/App.tsx`. Telas auxiliares: `CreateGameModal`, `SteamGridPicker` (só cover/banner/icon), `LocalImport`. Tipos em `src/types.ts`.

Credenciais só no `.env` do painel (`AWS_*`, `STEAMGRIDDB_API_KEY`). Sem prefixo `VITE_`. Copiar de `.env.example`.

## Cache

Catálogo e detalhes em `media-panel/.cache/` com TTL indefinido. S3 de novo só com **Atualizar**, após upload, ou invalidação explícita. Não usar a pasta `media/` como fonte do painel em runtime normal — só o sync local.

## Comandos

```bash
cd media-panel
npm run dev          # UI no browser + API Node
npm run tauri dev    # janela 1024×768
npm run build:exe    # binário Tauri + instaladores
npm run list:games   # pastas da raiz do bucket
```

Na raiz do repo: `npm run panel:dev` e `npm run panel:build`. O executável fica em `src-tauri/target/release/`; os instaladores em `src-tauri/target/release/bundle/`.
