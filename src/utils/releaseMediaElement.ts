/** Abort in-flight media I/O and free the decoder. Chrome stops new videos if too many stay attached. */
export function releaseMediaElement(media: HTMLMediaElement | null | undefined): void {
  if (!media) return;
  try {
    media.pause();
  } catch {
    /* already detached */
  }
  media.removeAttribute('src');
  media.removeAttribute('poster');
  while (media.firstChild) media.removeChild(media.firstChild);
  try {
    media.load();
  } catch {
    /* ignore */
  }
}
