let redirected = false;

/** The dashboard sends the owner to the wizard once per browser tab session, never in a loop. */
export const wasRedirected = () => redirected;
export const markRedirected = () => {
  redirected = true;
};
export const resetRedirect = () => {
  redirected = false;
};
