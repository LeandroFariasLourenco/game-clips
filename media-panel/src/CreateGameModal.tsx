import { useEffect, useState, type FormEvent } from "react";
import type { PickedSource } from "./api";
import { Icon } from "./icons";
import { SteamGridPicker } from "./SteamGridPicker";
import type { SteamGridKind, UploadKind } from "./types";

interface CreateGameModalProps {
  busy: boolean;
  onClose: () => void;
  onSubmit: (input: {
    name: string;
    cover?: PickedSource;
    banner?: PickedSource;
    icon?: PickedSource;
  }) => Promise<void>;
}

export function CreateGameModal({ busy, onClose, onSubmit }: CreateGameModalProps) {
  const [name, setName] = useState("");
  const [cover, setCover] = useState<PickedSource | null>(null);
  const [banner, setBanner] = useState<PickedSource | null>(null);
  const [icon, setIcon] = useState<PickedSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [steamGridKind, setSteamGridKind] = useState<SteamGridKind | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("O nome do jogo é obrigatório.");
      return;
    }
    setError(null);
    try {
      await onSubmit({
        name: trimmed,
        cover: cover ?? undefined,
        banner: banner ?? undefined,
        icon: icon ?? undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <form
        className="modal"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => void handleSubmit(event)}
      >
        <header>
          <div>
            <p className="eyebrow">Novo jogo</p>
            <h2>Cadastrar pasta no bucket</h2>
          </div>
          <button
            type="button"
            className="ghost icon-btn"
            onClick={onClose}
            disabled={busy}
            title="Fechar"
            aria-label="Fechar"
          >
            <Icon name="x" />
          </button>
        </header>

        <p className="muted">
          Só o nome é obrigatório. Capa, banner e thumb podem ficar vazios e ser enviados depois.
          A pasta será criada com <code>images/</code> e <code>videos/</code>.
        </p>

        <label className="field">
          Nome do jogo
          <input
            className="search"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ex.: Hades II"
            autoFocus
            disabled={busy}
          />
        </label>

        <div className="file-grid">
          <FileField
            label="Capa"
            hint="cover.jpg"
            accept=".jpg,.jpeg,image/jpeg"
            kind="cover"
            value={cover}
            onChange={setCover}
            disabled={busy}
            onSteamGrid={() => {
              if (!name.trim()) {
                setError("Informe o nome do jogo antes de buscar no SteamGridDB.");
                return;
              }
              setError(null);
              setSteamGridKind("cover");
            }}
          />
          <FileField
            label="Banner"
            hint="banner.jpg"
            accept=".jpg,.jpeg,image/jpeg"
            kind="banner"
            value={banner}
            onChange={setBanner}
            disabled={busy}
            onSteamGrid={() => {
              if (!name.trim()) {
                setError("Informe o nome do jogo antes de buscar no SteamGridDB.");
                return;
              }
              setError(null);
              setSteamGridKind("banner");
            }}
          />
          <FileField
            label="Thumb"
            hint="icon.png"
            accept=".png,image/png"
            kind="icon"
            value={icon}
            onChange={setIcon}
            disabled={busy}
            onSteamGrid={() => {
              if (!name.trim()) {
                setError("Informe o nome do jogo antes de buscar no SteamGridDB.");
                return;
              }
              setError(null);
              setSteamGridKind("icon");
            }}
          />
        </div>

        {error && <div className="banner error">{error}</div>}

        <footer>
          <button type="button" className="ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="primary" disabled={busy || !name.trim()}>
            <Icon name="plus" />
            {busy ? "Criando…" : "Criar jogo"}
          </button>
        </footer>
      </form>

      {steamGridKind && (
        <SteamGridPicker
          gameName={name.trim()}
          kind={steamGridKind}
          onClose={() => setSteamGridKind(null)}
          onPicked={(source) => {
            if (steamGridKind === "cover") setCover(source);
            if (steamGridKind === "banner") setBanner(source);
            if (steamGridKind === "icon") setIcon(source);
          }}
        />
      )}
    </div>
  );
}

function FileField({
  label,
  hint,
  accept,
  kind,
  value,
  onChange,
  disabled,
  onSteamGrid,
}: {
  label: string;
  hint: string;
  accept: string;
  kind: UploadKind;
  value: PickedSource | null;
  onChange: (value: PickedSource | null) => void;
  disabled: boolean;
  onSteamGrid: () => void;
}) {
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (value && "url" in value) {
      setPreview(value.thumb || value.url);
      return;
    }
    if (!value || !("file" in value) || !value.file.type.startsWith("image/")) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(value.file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [value]);

  return (
    <div className="file-field">
      <span>
        {label}
        <small>{hint}</small>
      </span>
      {preview ? <img src={preview} alt="" /> : <div className="placeholder file-preview" />}
      <input
        type="file"
        accept={accept}
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0];
          onChange(file ? { file, name: file.name } : null);
        }}
      />
      <button type="button" className="ghost" disabled={disabled} onClick={onSteamGrid}>
        <Icon name="grid" />
        SteamGridDB
      </button>
      <em>{value ? value.name : `Opcional · ${kind}`}</em>
    </div>
  );
}
