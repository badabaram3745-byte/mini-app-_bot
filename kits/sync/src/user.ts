/** A person, the same shape as the ClickUp kit's `User`. */
export interface User {
  kind: "user";
  id: string;
  name: string;
  /** Link to the person's profile; empty when the host does not name one. */
  url: string;
  /** Avatar URL. */
  image?: string;
}
