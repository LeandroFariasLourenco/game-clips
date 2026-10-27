import React, { useState } from 'react';
import { Game, GameMedia } from '../types/game';
import { localLibraryService } from '../services/driveService';
import { X, UploadCloud, Film, Image as ImageIcon, CheckCircle, AlertCircle } from 'lucide-react';

interface UploadMediaModalProps {
  game: Game;
  onClose: () => void;
  onUploaded: (media: GameMedia) => void;
}

export const UploadMediaModal: React.FC<UploadMediaModalProps> = ({
  game,
  onClose,
  onUploaded,
}) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedFile(file);
      setError(null);
      if (file.type.startsWith('image/')) {
        setPreviewUrl(URL.createObjectURL(file));
      } else {
        setPreviewUrl(null);
      }
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      setSelectedFile(file);
      setError(null);
      if (file.type.startsWith('image/')) {
        setPreviewUrl(URL.createObjectURL(file));
      } else {
        setPreviewUrl(null);
      }
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    setIsUploading(true);
    setError(null);

    try {
      const newMedia = await localLibraryService.saveMediaFile(game, selectedFile);
      setSuccess(true);
      onUploaded(newMedia);
      setTimeout(() => {
        onClose();
      }, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar mídia.');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fadeIn">
      <div className="relative w-full max-w-lg rounded-2xl bg-[#18181b] border border-zinc-800 p-6 shadow-2xl text-zinc-100">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-zinc-800">
          <div>
            <h3 className="text-base font-bold text-white">Adicionar Mídia</h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              Salvar localmente em {game.subfolderName}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-zinc-800 text-zinc-400 hover:text-white transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Dropzone */}
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          className="mt-5 border-2 border-dashed border-zinc-700 hover:border-purple-500 rounded-2xl p-6 text-center bg-zinc-900/50 transition cursor-pointer"
          onClick={() => document.getElementById('media-file-input')?.click()}
        >
          <input
            id="media-file-input"
            type="file"
            accept="image/*,video/*,.zip,.rar,.7z"
            onChange={handleFileChange}
            className="hidden"
          />

          {previewUrl ? (
            <div className="relative aspect-video max-h-48 mx-auto rounded-xl overflow-hidden border border-zinc-700 shadow-md">
              <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" />
            </div>
          ) : (
            <div className="py-6">
              <UploadCloud className="w-12 h-12 text-purple-400 mx-auto mb-3" />
              <p className="text-xs sm:text-sm font-medium text-zinc-200">
                Arraste capturas de tela ou vídeos aqui
              </p>
              <p className="text-[11px] text-zinc-500 mt-1">
                Suporta PNG, JPG, WEBP, MP4, WEBM, MKV e Backups ZIP
              </p>
            </div>
          )}

          {selectedFile && (
            <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-800 text-xs text-zinc-200 border border-zinc-700">
              {selectedFile.type.startsWith('video') ? (
                <Film className="w-3.5 h-3.5 text-rose-400" />
              ) : (
                <ImageIcon className="w-3.5 h-3.5 text-purple-400" />
              )}
              <span className="font-medium truncate max-w-xs">{selectedFile.name}</span>
              <span className="text-zinc-500">
                ({(selectedFile.size / (1024 * 1024)).toFixed(1)} MB)
              </span>
            </div>
          )}
        </div>

        {/* Status / Feedback */}
        {error && (
          <div className="mt-4 p-3 rounded-xl bg-rose-950/40 border border-rose-800 text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="mt-4 p-3 rounded-xl bg-emerald-950/40 border border-emerald-800 text-emerald-300 text-xs flex items-center gap-2">
            <CheckCircle className="w-4 h-4 shrink-0" />
            <span>Mídia enviada e sincronizada com sucesso!</span>
          </div>
        )}

        {/* Footer Actions */}
        <div className="mt-6 flex items-center justify-end gap-3 pt-4 border-t border-zinc-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium text-zinc-400 hover:text-white bg-zinc-800 hover:bg-zinc-700 transition cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleUpload}
            disabled={!selectedFile || isUploading || success}
            className="px-5 py-2 rounded-xl text-xs font-semibold text-white bg-purple-600 hover:bg-purple-500 disabled:opacity-50 transition shadow-lg shadow-purple-600/30 cursor-pointer"
          >
            {isUploading ? 'Enviando...' : 'Fazer Upload'}
          </button>
        </div>
      </div>
    </div>
  );
};
