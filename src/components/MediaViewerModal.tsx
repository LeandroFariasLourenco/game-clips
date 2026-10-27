import React, { useEffect } from 'react';
import { GameMedia } from '../types/game';
import { X, Download, Film, Image as ImageIcon, Archive } from 'lucide-react';

interface MediaViewerModalProps {
  media: GameMedia;
  onClose: () => void;
}

export const MediaViewerModal: React.FC<MediaViewerModalProps> = ({ media, onClose }) => {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-4 animate-fadeIn">
      {/* Top Bar */}
      <div className="absolute top-4 left-4 right-4 z-20 flex items-center justify-between pointer-events-auto">
        <div className="flex items-center gap-2 text-white bg-zinc-900/80 px-3 py-1.5 rounded-full border border-zinc-800 backdrop-blur-md">
          {media.type === 'video' ? (
            <Film className="w-3.5 h-3.5 text-rose-400 shrink-0" />
          ) : media.type === 'screenshot' ? (
            <ImageIcon className="w-3.5 h-3.5 text-purple-400 shrink-0" />
          ) : (
            <Archive className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
          )}
        </div>

        <div className="flex items-center gap-2">
          {media.url && media.url !== '#' && (
            <a
              href={media.url}
              download={media.name}
              target="_blank"
              rel="noreferrer"
              className="p-2 rounded-full bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 hover:text-white border border-zinc-800 transition"
              title="Baixar arquivo"
            >
              <Download className="w-4 h-4" />
            </a>
          )}
          <button
            onClick={onClose}
            className="p-2 rounded-full bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 hover:text-white border border-zinc-800 transition cursor-pointer"
            aria-label="Fechar visualizador"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="relative max-w-5xl max-h-[85vh] w-full flex items-center justify-center">
        {media.type === 'screenshot' ? (
          <img
            src={media.url}
            alt=""
            className="max-w-full max-h-[80vh] object-contain rounded-xl shadow-2xl border border-zinc-800/80"
          />
        ) : media.type === 'video' ? (
          <div className="w-full max-w-4xl aspect-video rounded-xl overflow-hidden bg-black border border-zinc-800 shadow-2xl">
            <video
              src={media.url}
              controls
              autoPlay
              className="w-full h-full object-contain"
            >
              Seu navegador não suporta reprodução deste vídeo.
            </video>
          </div>
        ) : (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 text-center max-w-md text-zinc-200">
            <Archive className="w-14 h-14 text-indigo-400 mx-auto mb-4" />
            <p className="text-xs text-zinc-400 mt-1">
              Arquivo de backup ou instalador salvo na pasta do jogo.
            </p>
            {media.url && media.url !== '#' && (
              <a
                href={media.url}
                download={media.name}
                className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-lg transition"
              >
                <Download className="w-4 h-4" />
                <span>Baixar Arquivo</span>
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
