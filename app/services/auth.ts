const APP_SESSION_KEY = "agentic_app_session";
const APP_SESSION_CHANNEL = "agentic_app_session_channel";

let sessionChannel: BroadcastChannel | null = null;

function getSessionChannel(): BroadcastChannel | null {
	if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
	if (!sessionChannel) {
		sessionChannel = new BroadcastChannel(APP_SESSION_CHANNEL);
		sessionChannel.onmessage = (event) => {
			if (event.data?.type === "session-request" && hasAppSession()) sessionChannel?.postMessage({ type: "session-present" });
		};
	}
	return sessionChannel;
}

function hasAppSession(): boolean {
	if (typeof window === "undefined") return false;
	return sessionStorage.getItem(APP_SESSION_KEY) === "1";
}

function createAppSession(): void {
	if (typeof window !== "undefined") sessionStorage.setItem(APP_SESSION_KEY, "1");
}

function clearAppSession(): void {
	if (typeof window !== "undefined") sessionStorage.removeItem(APP_SESSION_KEY);
}

export function hasActiveAppSession(): boolean {
	return hasAppSession();
}

export function discoverAppSession(): Promise<boolean> {
	if (hasAppSession()) return Promise.resolve(true);
	const channel = getSessionChannel();
	if (!channel) return Promise.resolve(false);
	return new Promise((resolve) => {
		let settled = false;
		const finish = (active: boolean) => {
			if (settled) return;
			settled = true;
			if (active) createAppSession();
			resolve(active);
		};
		const handler = (event: MessageEvent) => {
			if (event.data?.type === "session-present") finish(true);
		};
		channel.addEventListener("message", handler);
		channel.postMessage({ type: "session-request" });
		window.setTimeout(() => { channel.removeEventListener("message", handler); finish(hasAppSession()); }, 150);
	});
}

function notifySession(type: "session-present" | "session-logout"): void {
	getSessionChannel()?.postMessage({ type });
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
	createAppSession();
	notifySession("session-present");
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
	clearAppSession();
	notifySession("session-logout");
	await fetch("/api/v1/auth/logout", { method: "POST", credentials: "same-origin" });
}
