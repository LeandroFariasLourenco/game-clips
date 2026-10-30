# AGENTS.md

## Biblioteca de mídia (bucket S3)

O app recupera branding, `metadata.json` e mídia na distribuição CloudFront (`VITE_MEDIA_BUCKET_URL`):

`https://d3nyc65v53ljin.cloudfront.net`

O Worker só lista os jogos (`GET /` → `{ name, cover, banner, icon }`, URLs no CloudFront). Mídia e `metadata.json` vêm da distribuição. O bucket S3 é origem de escrita (`aws s3 sync` e o painel).

Não use a pasta local `media/` (está no `.gitignore`). O arquivo âncora é `games.json` na raiz do bucket. O catálogo fica em cache com TTL indefinido e só é buscado de novo quando o usuário aciona **Atualizar**.

Cada jogo tem uma pasta com o mesmo nome (caracteres inválidos de filesystem removidos). O app **só** recupera branding pelos nomes canônicos abaixo — sem fallbacks de formato (`.png`, `.jpeg`, `.webp`, `.ico`, `hero.*`).

```
<bucket>/<Nome do Jogo>/
  cover.jpg      # capa (grid, detalhes)
  banner.jpg     # banner / fundo
  icon.png       # ícone
  images/        # screenshots: .jpg (renomear .jpeg → .jpg); .png permitido na galeria
  videos/        # clips: cada .mp4 solto vira <nome-do-clip>/<nome-do-clip>.mp4 + thumb.jpg
                 # nomes: YYYY-MM-DDTHHmmssZ_Jogo#n.ext (UTC + sequência)
                 # preparar: npm run media:names / media:folders / media:faststart / media:thumbs / media:clip / media:metadata
                 # enviar: npm run deploy:media (apenas aws s3 sync)
```

Constantes em `src/config/mediaConfig.ts` (`GAME_BRANDING_ASSETS`, `DEFAULT_MEDIA_BUCKET_URL`).
