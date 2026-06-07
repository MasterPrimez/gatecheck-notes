/**
 * Shared types for the Notes Worker.
 */

export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  AUTH_BASE: string;
  SELF_BASE: string;
  LOGIN_URL: string;
}

/** Subset of the users table we care about here */
export interface User {
  id: string;
  email: string;
  name: string | null;
}

export type NoteKind = "note" | "todo";

/** A single checklist item inside a 'todo' note. */
export interface TodoItem {
  text: string;
  done: boolean;
}

/** An image attached to a note (dragged/dropped/pasted, stored in R2). */
export interface NoteImage {
  id: string;
  url: string; // /api/uploads/:id  (the client just uses this as <img src>)
  name: string;
}

/** Row shape in notes_notes. `items`/`images` are raw JSON strings in the DB. */
export interface NoteRow {
  id: string;
  owner_id: string;
  kind: NoteKind;
  content: string;
  items: string | null;
  images: string | null;
  pinned: number; // 0/1
  done: number; // 0/1
  created_at: number;
  updated_at: number;
}

/** A note as sent to the client — `items`/`images` parsed, tag ids attached. */
export interface NoteDTO {
  id: string;
  kind: NoteKind;
  content: string;
  items: TodoItem[] | null;
  images: NoteImage[];
  pinned: boolean;
  done: boolean;
  created_at: number;
  updated_at: number;
  tag_ids: string[];
}

/** Row shape in notes_uploads. */
export interface UploadRow {
  id: string;
  owner_id: string;
  r2_key: string;
  content_type: string;
  name: string | null;
  size_bytes: number;
  created_at: number;
}

export interface TagRow {
  id: string;
  owner_id: string;
  name: string;
  parent_id: string | null;
  position: number;
  created_at: number;
}

export interface TagDTO {
  id: string;
  name: string;
  parent_id: string | null;
  position: number;
}

/** Normalized link-preview payload returned by /api/preview. */
export interface LinkPreview {
  url: string;
  type: "link" | "image" | "error";
  title: string | null;
  description: string | null;
  image: string | null;
  site_name: string | null;
  favicon: string | null;
}

/** Hono context with our env + the authenticated user attached */
export type AppEnv = {
  Bindings: Env;
  Variables: {
    user: User;
  };
};
