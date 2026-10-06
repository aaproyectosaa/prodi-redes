/* firebase/auth falso: el usuario de la demo se elige con la barra superior. */
export const DEMO_UID_KEY = "prodi-demo-uid";
function currentUid() {
  try {
    return localStorage.getItem(DEMO_UID_KEY) || "u_lucas";
  } catch {
    return "u_lucas";
  }
}
const user = {
  uid: currentUid(),
  email: "demo@somosprodi.com",
  displayName: "Demo",
  providerData: [{ providerId: "password" }],
  getIdToken: async () => "demo-token",
};
const authObj = { currentUser: user };
export const auth = authObj;
export const sesionVencida = () => undefined;
export const guardarPush = async () => undefined;
export const usarLinkDeClave = async () => ({ user });
export const getAuth = () => authObj;
export const setPersistence = async () => undefined;
export const browserLocalPersistence = {};
export function onAuthStateChanged(_a: unknown, cb: (u: typeof user) => void) {
  setTimeout(() => cb(user), 10);
  return () => undefined;
}
export const signOut = async () => {
  window.dispatchEvent(new CustomEvent("demo-signout"));
};
export const signInWithEmailAndPassword = async () => ({ user });
export const createUserWithEmailAndPassword = async () => ({ user });
export const updateProfile = async () => undefined;
export const updatePassword = async () => undefined;
export const reauthenticateWithCredential = async () => undefined;
export const EmailAuthProvider = { credential: () => ({}) };
export type User = typeof user;
