export const isSafeRedirect = (path: string | undefined | null): boolean => {
  if (!path || !path.startsWith('/')) {
    return false;
  }
  try {
    const url = new URL(path, window.location.origin);
    // Check if the origin of the constructed URL is the same as the window's origin.
    return url.origin === window.location.origin;
  } catch (e) {
    // An error indicates an invalid URL.
    return false;
  }
};
