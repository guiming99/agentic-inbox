const APP_SESSION_KEY = "agentic_app_session";
const APP_SESSION_TAB_PREFIX = "agentic_app_session_tab:";
const APP_SESSION_LOGOUT_KEY = "agentic_app_session_logout";
const APP_SESSION_CHANNEL = "agentic_app_session_channel";
const SESSION_LEASE_MS = 5_000;
const SESSION_HEARTBEAT_MS = 1_000;

let sessionChannel: BroadcastChannel | null = null;
let heartbeatTimer: number | null = null;
let lifecycleInstalled = false;
let tabId: string | null = null;
const sessionListeners = new Set<(active: boolean) => void>();

function getTabId(): string {
	if (!tabId) {
		tabId = typeof crypto !== "undefined" && "randomUUID" in crypto
			? crypto.randomUUID()
			: `${Date.now()}-${Math.random().toString(36).slice(2)}`;
	}
	return tabId;
}

function getLeaseKey(): string {
	return `${APP_SESSION_TAB_PREFIX}${getTabId()}`;
}

function hasAppSession(): boolean {
	if (typeof window === "undefined") return false;
	try {
		return window.sessionStorage.getItem(APP_SESSION_KEY) === "1";
	} catch {
		return false;
	}
}

function createAppSessionMarker(): void {
	if (typeof window === "undefined") return;
	try {
		window.sessionStorage.setItem(APP_SESSION_KEY, "1");
	} catch {
		// The in-memory lease and server cookie still allow the current tab to operate.
	}
}

function clearAppSessionMarker(): void {
	if (typeof window === "undefined") return;
	try {
		window.sessionStorage.removeItem(APP_SESSION_KEY);
	} catch {
		// Ignore storage restrictions; the lease is removed separately.
	}
}

function readActiveLeases(): string[] {
	if (typeof window === "undefined") return [];
	const active: string[] = [];
	const now = Date.now();
	try {
		for (let i = 0; i < window.localStorage.length; i += 1) {
			const key = window.localStorage.key(i);
			if (!key?.startsWith(APP_SESSION_TAB_PREFIX)) continue;
			const expiresAt = Number(window.localStorage.getItem(key));
			if (Number.isFinite(expiresAt) && expiresAt > now) active.push(key);
			else window.localStorage.removeItem(key);
		}
	} catch {
		return [];
	}
	return active;
}

function writeLease(): void {
	if (typeof window === "undefined" || !hasAppSession()) return;
	try {
		window.localStorage.setItem(getLeaseKey(), String(Date.now() + SESSION_LEASE_MS));
	} catch {
		// Cross-tab discovery may be unavailable if browser storage is blocked.
	}
}

function removeOwnLease(): void {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.removeItem(getLeaseKey());
	} catch {
		// Best-effort cleanup; an abandoned lease expires after SESSION_LEASE_MS.
	}
}

function notifySessionListeners(active: boolean): void {
	for (const listener of sessionListeners) listener(active);
}

function getSessionChannel(): BroadcastChannel | null {
	if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
	if (!sessionChannel) {
		sessionChannel = new BroadcastChannel(APP_SESSION_CHANNEL);
		sessionChannel.onmessage = (event) => {
			if (event.data?.type === "session-logout") {
				clearAppSessionMarker();
				removeOwnLease();
				notifySessionListeners(false);
			}
		};
	}
	return sessionChannel;
}

function startSessionLease(): void {
	if (typeof window === "undefined" || !hasAppSession()) return;
	writeLease();
	getSessionChannel();
	if (heartbeatTimer === null) {
		heartbeatTimer = window.setInterval(() => {
			if (hasAppSession()) writeLease();
			else removeOwnLease();
		}, SESSION_HEARTBEAT_MS);
	}
	if (!lifecycleInstalled) {
		window.addEventListener("pagehide", removeOwnLease);
		window.addEventListener("storage", (event) => {
			if (event.key === APP_SESSION_LOGOUT_KEY) {
				clearAppSessionMarker();
				removeOwnLease();
				notifySessionListeners(false);
			}
		});
		lifecycleInstalled = true;
	}
}

export function hasActiveAppSession(): boolean {
	return hasAppSession();
}

export function subscribeAppSession(listener: (active: boolean) => void): () => void {
	sessionListeners.add(listener);
	return () => sessionListeners.delete(listener);
}

export async function discoverAppSession(): Promise<boolean> {
	if (typeof window === "undefined") return false;
	if (hasAppSession()) {
		startSessionLease();
		return true;
	}
	// A new tab may join an existing browser session, but a persistent localStorage
	// login flag is deliberately not used: only a live tab's short lease can grant access.
	if (readActiveLeases().length === 0) return false;
	createAppSessionMarker();
	startSessionLease();
	return true;
}

function broadcastLogout(): void {
	getSessionChannel()?.postMessage({ type: "session-logout" });
	try {
		// A storage event reaches other tabs even when BroadcastChannel is unavailable.
		window.localStorage.setItem(APP_SESSION_LOGOUT_KEY, `${Date.now()}-${getTabId()}`);
	} catch {
		// BroadcastChannel remains the fallback for browsers that block localStorage.
	}
}

export interface AuthUser {
	email: string;
	name: string;
	role: "admin" | "employee";
}

export async function getCurrentUser(): Promise<AuthUser | null> {
	const response = await fetch("/api/v1/auth/me", { credentials: "same-origin" });
	if (response.status === 401) return null;
	if (!response.ok) throw new Error("Unable to check authentication");
	const data = await response.json() as { user: AuthUser };
	return data.user;
}

export async function login(email: string, password: string): Promise<AuthUser> {
	const response = await fetch("/api/v1/auth/login", {
		method: "POST",
		credentials: "same-origin",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email, password }),
	});
	const data = await response.json().catch(() => ({})) as { user?: AuthUser; error?: string };
	if (!response.ok || !data.user) throw new Error(data.error || "Login failed");
	createAppSessionMarker();
	startSessionLease();
	notifySessionListeners(true);
	return data.user;
}

export async function register(name: string, email: string, password: string): Promise<void> {
	const response = await fetch("/api/v1/auth/register", {
		method: "POST",
		credentials: "same-origin",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ name, email, password }),
	});
	const data = await response.json().catch(() => ({})) as { error?: string };
	if (!response.ok) throw new Error(data.error || "Registration failed");
}

export async function logout(): Promise<void> {
	clearAppSessionMarker();
	removeOwnLease();
	broadcastLogout();
	try {
		await fetch("/api/v1/auth/logout", { method: "POST", credentials: "same-origin" });
	} finally {
		if (heartbeatTimer !== null && typeof window !== "undefined") {
			window.clearInterval(heartbeatTimer);
			heartbeatTimer = null;
		}
		notifySessionListeners(false);
	}
}
