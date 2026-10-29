# AGENTS.md

## Biblioteca de mídia (bucket S3)

O app recupera o catálogo e o branding no bucket público:

`https://game-clips-assets-306702688592-us-east-1-an.s3.us-east-1.amazonaws.com`

Não use a pasta local `media/` (está no `.gitignore`). O arquivo âncora é `games.json` na raiz do bucket. O catálogo fica em cache com TTL indefinido e só é buscado de novo quando o usuário aciona **Atualizar**.

Cada jogo tem uma pasta com o mesmo nome (caracteres inválidos de filesystem removidos). O app **só** recupera branding pelos nomes canônicos abaixo — sem fallbacks de formato (`.png`, `.jpeg`, `.webp`, `.ico`, `hero.*`).

```
<bucket>/<Nome do Jogo>/
  cover.jpg      # capa (grid, detalhes)
  banner.jpg     # banner / fundo
  icon.png       # ícone
  images/        # screenshots: .jpg (renomear .jpeg → .jpg); .png permitido na galeria
  videos/        # clips: cada .mp4 solto vira <nome-do-clip>/<nome-do-clip>.mp4 + thumb.jpg
                 # nomes: YYYYMMDDHHmmss-nomeoriginal.ext (mtime local; generate-video-thumbnails.cjs)
```

Constantes em `src/config/mediaConfig.ts` (`GAME_BRANDING_ASSETS`, `DEFAULT_MEDIA_BUCKET_URL`).
