const APP_SESSION_KEY = "agentic_app_session";

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
	await fetch("/api/v1/auth/logout", { method: "POST", credentials: "same-origin" });
}
