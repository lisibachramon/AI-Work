// Auth state shared across pages. Loaded once on app boot, refreshed on
// 401, cleared on logout. Svelte 5 runes — exported `state` is reactive.

import { api, ApiError, type Me } from "./api.ts";

class Session {
  user = $state<Me | null>(null);
  loading = $state(true);
  ready = $state(false);

  async refresh() {
    try {
      this.user = await api.get<Me>("/auth/me");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        this.user = null;
      } else {
        // Network / 5xx — leave whatever was there; the caller decides.
        console.warn("session refresh failed:", err);
      }
    } finally {
      this.loading = false;
      this.ready = true;
    }
  }

  async login(email: string, password: string) {
    const u = await api.post<Me>("/auth/login", { email, password });
    this.user = u;
  }

  async logout() {
    try {
      await api.post<{ ok: true }>("/auth/logout");
    } catch (err) {
      console.warn("logout call failed (clearing state anyway):", err);
    }
    this.user = null;
  }
}

export const session = new Session();
