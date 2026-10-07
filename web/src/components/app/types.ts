/** Narrow, client-safe shapes passed from server layouts to client chrome. */
export type ShellUser = {
  name: string;
  email: string;
  image: string | null;
  isAdmin: boolean;
};

export type ShellOrg = {
  id: string;
  name: string;
  slug: string;
};
