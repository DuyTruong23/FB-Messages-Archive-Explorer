/** True only in the bundle built with `vite build --mode android`. */
export function isAndroidApp(): boolean {
  return import.meta.env.MODE === 'android';
}
