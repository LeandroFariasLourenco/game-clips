import { useEffect, useMemo, useRef, useState } from "react";
import { formatBytes, getLocalMedia, getLocalSync, startLocalSync } from "./api";
import { Icon } from "./icons";
import type { LocalMediaInventory, LocalSyncStatus } from "./types";

export function LocalImport({ onImported }: { onImported?: () => void }) {
  const [inventory, setInventory] = useState<LocalMediaInventory | null>(null);
  const [sync, setSync] = useState<LocalSyncStatus | null>(null);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLPreElement>(null);
  const sawRunning = useRef(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [nextInventory, nextSync] = await Promise.all([getLocalMedia(), getLocalSync()]);
      setInventory(nextInventory);
      setSync(nextSync);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (sync?.status === "running") sawRunning.current = true;
    if (sawRunning.current && sync?.status === "success") {
      sawRunning.current = false;
      onImported?.();
    }
  }, [sync?.status, onImported]);

  useEffect(() => {
    if (sync?.status !== "running") return;
    const timer = window.setInterval(() => {
      void getLocalSync()
        .then(setSync)
        .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [sync?.status]);

  useEffect(() => {
    const node = logRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [sync?.log]);

  const games = inventory?.games ?? [];
  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return games;
    return games.filter((game) => game.name.toLowerCase().includes(needle));
  }, [games, filter]);

  const running = sync?.status === "running" || starting;
  const canSync = Boolean(inventory?.exists && inventory.destination) && !running && !loading;

  async function handleSync() {
    if (!inventory?.destination) return;
    const confirmed = window.confirm(
      [
        `Preparar a pasta local e enviar tudo para ${inventory.destination.uri}?`,
        "",
        "Antes do envio, o painel organiza os vídeos em videos/<nome>/<nome>.mp4, move o índice moov para o início (faststart), gera thumb.jpg e grava metadata.json na raiz de cada jogo.",
        "Depois executa aws s3 sync da pasta inteira. Arquivos iguais são ignorados. Nada é apagado no bucket.",
        "",
        "Confirme só se media/ já tiver a biblioteca completa.",
      ].join("\n"),
    );
    if (!confirmed) return;

    setStarting(true);
    setError(null);
    try {
      setSync(await startLocalSync());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  }

  const totals = inventory?.totals;
  const command =
    inventory?.destination &&
    `aws s3 sync "${inventory.root}" ${inventory.destination.uri} --region ${inventory.destination.region} --no-progress`;

  return (
    <section className="local-import">
      <header className="local-head">
        <div>
          <p className="eyebrow">Pasta media</p>
          <h2>Importar biblioteca local</h2>
          <p className="muted">
            Resumo do que está no disco. Esta leitura não altera arquivos. O deploy, depois da
            confirmação, padroniza os vídeos, aplica faststart, gera as miniaturas, grava metadata.json e só então
            sincroniza a pasta inteira.
          </p>
        </div>
        <button className="ghost" onClick={() => void load()} disabled={loading || running}>
          <Icon name="refresh" className={loading ? "spin" : undefined} />
          {loading ? "Lendo…" : "Reler pasta"}
        </button>
      </header>

      {error && <div className="banner error">{error}</div>}

      {inventory && !inventory.exists && (
        <div className="banner error">Pasta não encontrada: {inventory.root}</div>
      )}

      {inventory?.exists && (
        <>
          <p className="path">{inventory.root}</p>
          <p className="count">
            Lido em {new Date(inventory.scannedAt).toLocaleString("pt-BR")}
            {inventory.hasManifest ? " · games.json presente" : " · games.json ausente"}
          </p>

          {totals && (
            <div className="stat-grid">
              <Stat label="Jogos" value={String(totals.games)} />
              <Stat label="Arquivos" value={String(totals.files)} />
              <Stat label="Tamanho" value={formatBytes(totals.bytes)} />
              <Stat label="Capas" value={`${totals.covers}/${totals.games}`} />
              <Stat label="Banners" value={`${totals.banners}/${totals.games}`} />
              <Stat label="Ícones" value={`${totals.icons}/${totals.games}`} />
              <Stat label="Imagens" value={String(totals.images)} />
              <Stat label="Vídeos" value={String(totals.videos)} />
              <Stat label="Vídeos soltos" value={String(totals.looseVideos)} />
              <Stat label="Miniaturas" value={String(totals.thumbs)} />
              <Stat label="Sem thumb" value={String(totals.missingThumbs)} />
              <Stat label="metadata.json" value={`${totals.metadata}/${totals.games}`} />
              <Stat label="Outros" value={String(totals.other)} />
            </div>
          )}

          {inventory.otherSamples.length > 0 && (
            <section className="panel">
              <h3>Arquivos fora do layout</h3>
              <p className="muted">
                Até 30 caminhos que não são capa, banner, ícone, metadata.json, screenshot, clip ou thumb.jpg.
              </p>
              <ul className="files">
                {inventory.otherSamples.map((path) => (
                  <li key={path}>
                    <span>{path}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="panel">
            <header>
              <div>
                <h3>Por jogo</h3>
                <p className="muted">
                  {visible.length} de {games.length} jogo{games.length === 1 ? "" : "s"}
                </p>
              </div>
              <input
                className="search local-filter"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Filtrar jogo local"
              />
            </header>
            <div className="local-table-wrap">
              <table className="local-table">
                <thead>
                  <tr>
                    <th>Jogo</th>
                    <th>Capa</th>
                    <th>Banner</th>
                    <th>Ícone</th>
                    <th>Imagens</th>
                    <th>Vídeos</th>
                    <th>Soltos</th>
                    <th>Thumbs</th>
                    <th>Sem thumb</th>
                    <th>Meta</th>
                    <th>Outros</th>
                    <th>Tamanho</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((game) => (
                    <tr key={game.name}>
                      <td>{game.name}</td>
                      <td className={game.hasCover ? "ok" : "missing"}>{game.hasCover ? "sim" : "não"}</td>
                      <td className={game.hasBanner ? "ok" : "missing"}>{game.hasBanner ? "sim" : "não"}</td>
                      <td className={game.hasIcon ? "ok" : "missing"}>{game.hasIcon ? "sim" : "não"}</td>
                      <td>{game.images}</td>
                      <td>{game.videos}</td>
                      <td>{game.looseVideos}</td>
                      <td>{game.thumbs}</td>
                      <td>{game.missingThumbs}</td>
                      <td className={game.hasMetadata ? "ok" : "missing"}>{game.hasMetadata ? "sim" : "não"}</td>
                      <td>{game.other}</td>
                      <td>{formatBytes(game.bytes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel">
            <header>
              <div>
                <h3>Deploy para o S3</h3>
                <p className="muted">
                  Organiza cada vídeo em videos/&lt;nome&gt;/&lt;nome&gt;.mp4, aplica faststart,
                  gera thumb.jpg, grava metadata.json ao lado da capa e envia a pasta inteira. O JSON lista images
                  com a URL de cada screenshot e videos com a URL do mp4 e a URL da thumb. Objetos
                  iguais no bucket são ignorados. Arquivos que existem só no bucket permanecem lá.
                </p>
              </div>
              <button className="danger sync-button" disabled={!canSync} onClick={() => void handleSync()}>
                <Icon name="cloud" />
                {running ? "Publicando…" : "Publicar pasta no S3"}
              </button>
            </header>

            {inventory.destination ? (
              <p className="muted">
                Destino: {inventory.destination.uri} · {inventory.destination.region}
              </p>
            ) : (
              <p className="missing">{inventory.destinationError || "Destino do bucket indisponível."}</p>
            )}

            {command && <p className="path">{command}</p>}

            {sync && sync.status !== "idle" && (
              <div className="sync-status">
                <p className={sync.status === "error" ? "missing" : sync.status === "success" ? "ok" : "muted"}>
                  {sync.status === "running" && "Sync em andamento."}
                  {sync.status === "success" && "Sync concluído. Use Atualizar para reler o bucket."}
                  {sync.status === "error" && (sync.error || "Sync falhou.")}
                </p>
                {sync.log.length > 0 && (
                  <pre ref={logRef} className="sync-log">
                    {sync.log.join("\n")}
                  </pre>
                )}
              </div>
            )}
          </section>
        </>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <article className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}
