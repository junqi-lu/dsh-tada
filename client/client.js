window.__ModuleLoader__.load({ id: "dsh-tada", factory: (require) => {


		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		// src/client/config.js
		/** SSE stream carrying Host alerts to the page. */
		const EVENTS_ROUTE = "/dsh-tada/events";
		/** Page → Host state reports (focus, open conversation, permission). */
		const STATE_ROUTE = "/dsh-tada/state";
		/** Default in-app toast hold time when the Host does not send holdMs. */
		const DEFAULT_HOLD_MS = 5e3;
		/** Page ↔ Host notification-settings route (Settings → Notifications). */
		const SETTINGS_ROUTE = "/dsh-tada/settings";
		// src/client/host.js
		/** Resolve an optional platform module from the page's module table. */
		function optionalRequire(specifier) {
			try {
				return require(specifier);
			} catch {
				return;
			}
		}
		function service(ctx, name) {
			try {
				return ctx && typeof ctx.get === "function" ? ctx.get(name) : void 0;
			} catch {
				return;
			}
		}
		function notificationApi() {
			try {
				return typeof Notification === "undefined" ? void 0 : Notification;
			} catch {
				return;
			}
		}
		function permission() {
			const api = notificationApi();
			return api ? api.permission : "unsupported";
		}
		function requestPermission() {
			const api = notificationApi();
			if (!api) return Promise.resolve("unsupported");
			if (api.permission !== "default") return Promise.resolve(api.permission);
			try {
				const result = api.requestPermission();
				if (result && typeof result.then === "function") return result.catch(() => "default");
				return Promise.resolve(result);
			} catch {
				return Promise.resolve("default");
			}
		}
		function focusWindow() {
			try {
				window.focus();
			} catch {}
		}
		/** Reveal the Session that produced the notification (best effort). */
		function openSession(ctx, sessionId) {
			if (typeof sessionId !== "string" || sessionId.length === 0) return;
			try {
				const uiWorkspace = service(ctx, "uiWorkspace");
				if (uiWorkspace && typeof uiWorkspace.openSession === "function") uiWorkspace.openSession(sessionId);
			} catch {}
		}
		/** True when this page (the DSH window/tab) is the focused document. */
		function isPageFocused() {
			try {
				if (typeof document === "undefined") return false;
				if (typeof document.hasFocus === "function") return document.hasFocus() === true;
				return document.visibilityState === "visible";
			} catch {
				return false;
			}
		}
		function pageLabel() {
			try {
				if (typeof location === "undefined") return "";
				return `${location.protocol}//${location.host}`.slice(0, 120);
			} catch {
				return "";
			}
		}
		function createClientId() {
			try {
				if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
			} catch {}
			return `page-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
		}
		// src/client/session.js
		/**
		* The conversation open in the main view, read the same way the app itself
		* decides it: the row retained by `mainView`. Falls back to `null` when the
		* sessions service is absent or shaped differently, which degrades to "not
		* viewing this conversation" rather than to a missed alert.
		*/
		function readActiveSession(ctx) {
			try {
				const sessions = service(ctx, "sessions");
				const list = sessions && sessions.list;
				const snapshot = list && typeof list.getSnapshot === "function" ? list.getSnapshot() : void 0;
				const byId = snapshot && snapshot.byId;
				if (!byId || typeof byId !== "object") return null;
				for (const row of Object.values(byId)) {
					if (!row || typeof row.id !== "string") continue;
					const retainedBy = row.retainedBy;
					if (retainedBy && typeof retainedBy.mainView === "number" && retainedBy.mainView > 0) return row.id;
				}
			} catch {}
			return null;
		}
		/** Observe active-Session changes; the caller polls for late service arrival. */
		function watchActiveSession(ctx, onChange) {
			let unsubscribe = () => {};
			try {
				const sessions = service(ctx, "sessions");
				const list = sessions && sessions.list;
				if (list && typeof list.subscribe === "function") {
					let last;
					const emit = () => {
						const next = readActiveSession(ctx);
						if (next === last) return;
						last = next;
						onChange(next);
					};
					emit();
					const dispose = list.subscribe(emit);
					if (typeof dispose === "function") unsubscribe = dispose;
					return () => {
						try {
							unsubscribe();
						} catch {}
					};
				}
			} catch {}
			onChange(readActiveSession(ctx));
			return () => {};
		}
		// src/client/system.js
		/**
		* Turn one Host frame into a native Notification. The page is the source of
		* truth for the app's identity: a notification created here is owned by the
		* Electron renderer, so the OS credits DeepSeek Harness and the click handler
		* can reveal the exact Session.
		*
		* @returns whether the OS accepted a banner request
		*/
		function showSystemNotification(ctx, payload) {
			const api = notificationApi();
			if (!api || api.permission !== "granted") return false;
			if (!payload || typeof payload.title !== "string") return false;
			const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : void 0;
			let notification;
			try {
				notification = new api(payload.title, {
					body: typeof payload.body === "string" ? payload.body : "",
					tag: `dsh-tada:${sessionId || "global"}:${payload.kind || "notification"}`
				});
			} catch {
				return false;
			}
			notification.onclick = () => {
				focusWindow();
				openSession(ctx, sessionId);
				try {
					notification.close();
				} catch {}
			};
			return true;
		}
		// src/client/present.js
		/**
		* Turn one Host frame into the right presentation, re-checking focus and the
		* open conversation at display time (the Host's view may be a few hundred
		* milliseconds stale).
		*/
		function present(ctx, toast, payload) {
			if (!payload || typeof payload !== "object") return;
			if (typeof payload.title !== "string") return;
			const focused = isPageFocused();
			const target = typeof payload.sessionId === "string" && payload.sessionId !== "" ? payload.sessionId : null;
			const active = target !== null ? readActiveSession(ctx) : null;
			if (focused && target !== null && active === target) return;
			if (focused) {
				toast.push(payload);
				return;
			}
			if (!showSystemNotification(ctx, payload)) toast.push(payload);
		}
		// src/client/nav-icon.js
		/** Attribute the stylesheet keys the bell swap on; React never touches it. */
		const NAV_ICON_ATTRIBUTE = "data-tada-nav-icon";
		/** Every settings-nav row: the shell portal renders nav > button rows. */
		const NAV_ROW_SELECTOR = "[role=\"dialog\"] nav button";
		/** Stylesheet id, so repeated installs (hot reload) share one <style> tag. */
		const STYLE_ID = "dsh-tada-settings-nav-icon";
		/**
		* Bell outline in the Harness icon language: a 24-unit viewBox with a 2-unit
		* stroke, which the 16px mask box scales to the shell's 1.3px icon stroke.
		*/
		const BELL_SVG = [
			"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\"",
			" stroke=\"black\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\">",
			"<path d=\"M10.268 21a2 2 0 0 0 3.464 0\"/>",
			"<path d=\"M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8",
			"A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326\"/>",
			"</svg>"
		].join("");
		/** The bell as a mask source, so the glyph paints in the row's text color. */
		const BELL_MASK = `url("data:image/svg+xml,${encodeURIComponent(BELL_SVG)}")`;
		/** Swap the shell glyph for the bell on the marked row only. */
		const STYLE = [
			`[${NAV_ICON_ATTRIBUTE}] > svg { display: none !important; }`,
			`[${NAV_ICON_ATTRIBUTE}]::before {`,
			"  content: '';",
			"  flex: none;",
			"  width: 16px;",
			"  height: 16px;",
			"  background-color: currentColor;",
			`  -webkit-mask: ${BELL_MASK} center / contain no-repeat;`,
			`  mask: ${BELL_MASK} center / contain no-repeat;`,
			"  -webkit-mask-repeat: no-repeat;",
			"  mask-repeat: no-repeat;",
			"  -webkit-mask-position: center;",
			"  mask-position: center;",
			"  -webkit-mask-size: 16px 16px;",
			"  mask-size: 16px 16px;",
			"}"
		].join("\n");
		/** Put the bell stylesheet in the page once. */
		function ensureStyle$1(doc) {
			if (typeof doc.getElementById !== "function") return;
			if (doc.getElementById(STYLE_ID) !== null) return;
			const tag = doc.createElement("style");
			tag.id = STYLE_ID;
			tag.textContent = STYLE;
			(doc.head ?? doc.documentElement).appendChild(tag);
		}
		/** The page's registered nav label, which may follow the page language. */
		function readLabel(label) {
			try {
				return String(typeof label === "function" ? label() : label ?? "").trim();
			} catch {
				return "";
			}
		}
		/** Exact-label match; an empty label never decorates a row. */
		function isOurRow(button, label) {
			return label !== "" && String(button.textContent ?? "").trim() === label;
		}
		/**
		* Mark the matching nav row and unmark any row that no longer matches, so a
		* same-named row elsewhere and a language switch both settle to one bell.
		*/
		function syncRow(button, label) {
			if (isOurRow(button, label)) {
				if (typeof button.getAttribute === "function" && button.getAttribute("data-tada-nav-icon") === "") return false;
				button.setAttribute(NAV_ICON_ATTRIBUTE, "");
				return true;
			}
			if (typeof button.hasAttribute === "function" && button.hasAttribute("data-tada-nav-icon")) {
				button.removeAttribute(NAV_ICON_ATTRIBUTE);
				return true;
			}
			return false;
		}
		/**
		* Decorate the notification section's Settings-nav row with a bell, keeping it
		* in sync while the dialog is re-created and the page language changes.
		*
		* @param label Current nav label, e.g. `() => '通知'`.
		* @returns Disposer that unmarks every row (the gear comes back).
		*/
		function installNotificationNavIcon(label) {
			if (typeof document === "undefined") return () => {};
			const doc = document;
			if (typeof doc.querySelectorAll !== "function" || !(doc.body ?? doc.documentElement)) return () => {};
			try {
				ensureStyle$1(doc);
			} catch {
				return () => {};
			}
			let stopped = false;
			let queued = false;
			const sync = () => {
				queued = false;
				if (stopped) return;
				const wanted = readLabel(label);
				const rows = doc.querySelectorAll(NAV_ROW_SELECTOR);
				for (let index = 0; index < rows.length; index += 1) try {
					syncRow(rows[index], wanted);
				} catch {}
			};
			const schedule = () => {
				if (queued || stopped) return;
				queued = true;
				if (typeof queueMicrotask === "function") queueMicrotask(sync);
				else Promise.resolve().then(sync);
			};
			sync();
			let observer = null;
			try {
				if (typeof MutationObserver === "function") {
					observer = new MutationObserver(schedule);
					observer.observe(doc.body ?? doc.documentElement, {
						childList: true,
						subtree: true,
						characterData: true
					});
				}
			} catch {
				observer = null;
			}
			return () => {
				stopped = true;
				queued = false;
				try {
					observer?.disconnect();
				} catch {}
				observer = null;
				const marked = doc.querySelectorAll(`[${NAV_ICON_ATTRIBUTE}]`);
				for (let index = 0; index < marked.length; index += 1) try {
					marked[index].removeAttribute(NAV_ICON_ATTRIBUTE);
				} catch {}
			};
		}
		// src/client/ui.js
		const React = optionalRequire("react");
		const primitives = optionalRequire("@deepseek-ai/dsh-client-ui-primitives");
		// src/client/toast.js
		/**
		* Manual-dismiss toast hold time, in milliseconds.
		*
		* The Harness Toast primitive always schedules its own fade and unmount: the
		* CSS animation starts after `--dsh-toast-hold` and the JS timer fires at
		* `holdMs + 1000`. There is no "never" value, so manual mode uses a delay far
		* beyond any session (about 23 days) and the toast is removed by the user's
		* 查看/关闭 action long before that.
		*/
		const PERSISTENT_HOLD_MS = 2e9;
		/**
		* The Harness Toast primitive renders its copy as one text run, so the toast
		* passes the composed copy with the title and body separated by a newline.
		* Collapsing whitespace would silently join them again, hence this rule: it
		* keeps that newline, and it follows the primitive's public `role="alert"`
		* banner and its trailing copy span. Scoped to the primitive's root `div`; our
		* own fallback toast styles the line break inline.
		*
		* Exported because the Settings stylesheet owns the same `<style
		* data-plugin-css="dsh-tada">` tag: when it is (re)written, this rule has to
		* survive in it.
		*/
		const TOAST_NEWLINE_CSS = "div[role=\"alert\"]>span:last-child{white-space:pre-line}";
		/**
		* Make sure the newline rule is live before the first toast, even on a page
		* whose Settings section has not rendered (and so has not written the full
		* stylesheet). Reuses the Settings tag so a later rewrite it in place.
		*/
		function ensureToastStyle() {
			try {
				if (typeof document === "undefined" || !document.head || typeof document.createElement !== "function") return;
				const existing = typeof document.head.querySelector === "function" ? document.head.querySelector("style[data-plugin-css=\"dsh-tada\"]") : null;
				if (existing) {
					if (typeof existing.textContent === "string" && !existing.textContent.includes("div[role=\"alert\"]>span:last-child{white-space:pre-line}")) existing.textContent += TOAST_NEWLINE_CSS;
					return;
				}
				const tag = document.createElement("style");
				tag.setAttribute("data-plugin-css", "dsh-tada");
				tag.textContent = TOAST_NEWLINE_CSS;
				document.head.appendChild(tag);
			} catch {}
		}
		/** Localized label of the manual toast's dismiss action. */
		function dismissLabelOf(notice) {
			return typeof notice.dismissLabel === "string" && notice.dismissLabel !== "" ? notice.dismissLabel : "Dismiss";
		}
		function createToastStore() {
			const queued = [];
			let current = null;
			const listeners = /* @__PURE__ */ new Set();
			const emit = () => {
				for (const listener of Array.from(listeners)) try {
					listener();
				} catch {}
			};
			const advance = () => {
				if (current !== null || queued.length === 0) return;
				current = queued.shift();
				emit();
			};
			return {
				subscribe(listener) {
					listeners.add(listener);
					return () => {
						listeners.delete(listener);
					};
				},
				getSnapshot() {
					return current;
				},
				push(notice) {
					if (!notice || typeof notice.text !== "string" || notice.text === "") return;
					queued.push(notice);
					while (queued.length > 6) queued.shift();
					advance();
				},
				dismiss(id) {
					if (current === null) return;
					if (id !== void 0 && current.id !== id) return;
					current = null;
					emit();
					advance();
				},
				clear() {
					queued.length = 0;
					current = null;
					emit();
				}
			};
		}
		function clampToastText(value, maxLength = 240) {
			const text = String(value ?? "").replace(/\s+/g, " ").trim();
			if (text.length <= maxLength) return text;
			return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
		}
		/** Longest toast copy, title line included. */
		const TOAST_TEXT_MAX_LENGTH = 240;
		/** Longest title line; leaves the rest of the budget to the body. */
		const TOAST_TITLE_MAX_LENGTH = 120;
		/**
		* Compose the toast copy with the title on its own line and the body below it,
		* mirroring the Settings → 通知 toast preview. The primitive keeps the break
		* (see {@link TOAST_NEWLINE_CSS}); the fallback toast sets `white-space`
		* inline.
		*/
		function toastText(payload) {
			const title = clampToastText(payload.title, TOAST_TITLE_MAX_LENGTH);
			const body = clampToastText(payload.body, Math.max(40, TOAST_TEXT_MAX_LENGTH - title.length));
			if (body === "") return title;
			if (title === "") return body;
			return `${title}\n${body}`;
		}
		/** Harness-styled toast: the primitive inside `shell.overlay`. */
		function createReactToastHost(ctx, store) {
			const Toast = primitives && primitives.Toast;
			const slots = service(ctx, "slots");
			if (!React || typeof React.createElement !== "function" || !Toast) return void 0;
			if (!slots || typeof slots.inject !== "function" || typeof slots.register !== "function") return void 0;
			function NotificationToast() {
				const [notice, setNotice] = React.useState(store.getSnapshot());
				React.useEffect(() => {
					const dispose = store.subscribe(() => setNotice(store.getSnapshot()));
					return () => {
						try {
							dispose();
						} catch {}
					};
				}, []);
				if (notice === null) return null;
				const manual = notice.manual === true;
				const actions = [];
				if (typeof notice.sessionId === "string" && notice.sessionId !== "") actions.push({
					label: notice.actionLabel || "Open",
					onClick: () => {
						focusWindow();
						openSession(ctx, notice.sessionId);
						store.dismiss(notice.id);
					}
				});
				if (manual) actions.push({
					prefix: actions.length > 0 ? " · " : "",
					label: dismissLabelOf(notice),
					onClick: () => store.dismiss(notice.id)
				});
				return React.createElement(Toast, {
					key: notice.id,
					text: notice.text,
					holdMs: manual ? PERSISTENT_HOLD_MS : notice.holdMs,
					...actions.length > 0 ? { actions } : {},
					onDone: () => store.dismiss(notice.id)
				});
			}
			try {
				const disposeInject = slots.inject("shell.overlay", () => slots.register({
					name: "shell.overlay",
					id: "dsh-tada-toast",
					order: 100
				}, NotificationToast));
				return () => {
					try {
						if (typeof disposeInject === "function") disposeInject();
					} catch {}
					store.clear();
				};
			} catch {
				return;
			}
		}
		/** Plain-DOM toast fallback, themed with Harness design tokens. */
		function createDomToastHost(ctx, store) {
			try {
				if (typeof document === "undefined" || !document.body) return void 0;
			} catch {
				return;
			}
			let element = null;
			let timer = null;
			const render = () => {
				const notice = store.getSnapshot();
				if (timer !== null) {
					clearTimeout(timer);
					timer = null;
				}
				if (notice === null) {
					if (element !== null && element.parentNode) element.parentNode.removeChild(element);
					element = null;
					return;
				}
				if (element === null) {
					element = document.createElement("div");
					element.setAttribute("role", "alert");
					element.setAttribute("data-dsh-tada-toast", "");
					Object.assign(element.style, {
						position: "fixed",
						top: "40px",
						left: "50%",
						transform: "translateX(-50%)",
						zIndex: "1100",
						display: "flex",
						alignItems: "center",
						gap: "10px",
						maxWidth: "min(640px, calc(100vw - 48px))",
						padding: "12px 16px",
						borderRadius: "var(--dsw-radius-lg, 12px)",
						background: "var(--dsw-alias-toast-bg, #2c2c2e)",
						color: "var(--dsw-alias-toast-label, #fff)",
						font: "400 14px/22px system-ui, -apple-system, sans-serif",
						boxShadow: "0 8px 24px #00000033",
						pointerEvents: "none"
					});
					document.body.appendChild(element);
				}
				const manual = notice.manual === true;
				element.setAttribute("data-dsh-tada-dismiss", manual ? "manual" : "auto");
				for (const child of Array.from(element.childNodes)) child.remove();
				const text = document.createElement("span");
				text.textContent = notice.text;
				text.style.whiteSpace = "pre-line";
				element.appendChild(text);
				if (typeof notice.sessionId === "string" && notice.sessionId !== "") {
					const action = document.createElement("button");
					action.type = "button";
					action.textContent = notice.actionLabel || "Open";
					action.setAttribute("data-dsh-tada-open", "");
					Object.assign(action.style, {
						display: "inline",
						padding: "0",
						border: "0",
						background: "none",
						color: "var(--dsw-static-deepseek-400, #5686fe)",
						font: "inherit",
						cursor: "pointer",
						pointerEvents: "auto"
					});
					action.addEventListener("click", () => {
						focusWindow();
						openSession(ctx, notice.sessionId);
						store.dismiss(notice.id);
					});
					element.appendChild(action);
				}
				if (manual) {
					const close = document.createElement("button");
					close.type = "button";
					close.textContent = dismissLabelOf(notice);
					close.setAttribute("data-dsh-tada-close", "");
					close.setAttribute("aria-label", dismissLabelOf(notice));
					Object.assign(close.style, {
						display: "inline",
						padding: "0",
						border: "0",
						background: "none",
						color: "var(--dsw-alias-label-tertiary, #c4c7cc)",
						font: "inherit",
						cursor: "pointer",
						pointerEvents: "auto"
					});
					close.addEventListener("click", () => store.dismiss(notice.id));
					element.appendChild(close);
				} else {
					const holdMs = Number.isFinite(notice.holdMs) && notice.holdMs > 0 ? notice.holdMs : DEFAULT_HOLD_MS;
					timer = setTimeout(() => store.dismiss(notice.id), holdMs);
				}
			};
			const unsubscribe = store.subscribe(render);
			render();
			return () => {
				unsubscribe();
				if (timer !== null) clearTimeout(timer);
				if (element !== null && element.parentNode) element.parentNode.removeChild(element);
			};
		}
		function createToastPresenter(ctx) {
			ensureToastStyle();
			const store = createToastStore();
			let dispose = createReactToastHost(ctx, store);
			if (dispose === void 0) dispose = createDomToastHost(ctx, store);
			return {
				push(payload) {
					store.push({
						id: typeof payload.id === "string" ? payload.id : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
						text: toastText(payload),
						sessionId: typeof payload.sessionId === "string" ? payload.sessionId : null,
						actionLabel: typeof payload.actionLabel === "string" ? payload.actionLabel : "",
						dismissLabel: typeof payload.dismissLabel === "string" ? payload.dismissLabel : "",
						manual: payload.dismiss === "manual",
						holdMs: Number.isFinite(payload.holdMs) ? payload.holdMs : void 0
					});
				},
				dispose() {
					if (typeof dispose === "function") try {
						dispose();
					} catch {}
					store.clear();
				}
			};
		}
		// src/client/settings.js
		/** Preset catalog used before the Host answers, or when it cannot. */
		const FALLBACK_PRESETS = [
			"app",
			"event",
			"session",
			"workspace",
			"detail"
		];
		/** Local defaults, identical to the Host's DEFAULT_DISPLAY. */
		const DEFAULT_DISPLAY = {
			title: "{{event}}",
			body: "{{session}}"
		};
		/** Local toast defaults, identical to the plugin Config defaults. */
		const DEFAULT_TOAST = {
			dismiss: "auto",
			holdMs: 5e3
		};
		/**
		* Local mirror of the Host plugin-Config defaults (lib/config.js), used before
		* the Host answers and when it cannot. Every key the notification page edits is
		* listed so a failed GET still renders a complete, resettable form.
		*/
		const CONFIG_DEFAULTS = Object.freeze({
			enabled: true,
			notifyOnTurnEnd: true,
			notifyOnError: true,
			notifyOnApproval: true,
			notifyOnQuestion: true,
			notifyOnSubagentEnd: false,
			notifyOnWorkflowEnd: false,
			notifyOnGoalComplete: false,
			notifySubagentSessions: false,
			includePreview: true,
			webNotifications: true,
			inAppNotifications: true,
			suppressActiveSession: true,
			inAppToastDismiss: "auto",
			inAppHoldMs: 5e3,
			appName: "DSH",
			quietHours: "",
			minIntervalMs: 1500,
			bodyMaxLength: 160,
			language: "auto"
		});
		/** Bounds the Host clamps every Config number to. */
		const CONFIG_LIMITS = Object.freeze({
			minIntervalMs: Object.freeze([0, 6e5]),
			bodyMaxLength: Object.freeze([20, 500])
		});
		/** Longest app name the Host stores. */
		const APP_NAME_MAX_LENGTH = 40;
		/** Languages the Host accepts; anything else falls back to `auto`. */
		const CONFIG_LANGUAGES = Object.freeze([
			"auto",
			"zh",
			"en"
		]);
		/** Event switches, in card order: [Config key, copy id]. */
		const EVENT_SWITCHES = Object.freeze([
			["notifyOnTurnEnd", "turnEnd"],
			["notifyOnError", "error"],
			["notifyOnApproval", "approval"],
			["notifyOnQuestion", "question"],
			["notifyOnSubagentEnd", "subagentEnd"],
			["notifyOnWorkflowEnd", "workflowEnd"],
			["notifyOnGoalComplete", "goalComplete"]
		]);
		/** Delivery-channel switches, in card order: [Config key, copy id]. */
		const CHANNEL_SWITCHES = Object.freeze([
			["webNotifications", "web"],
			["inAppNotifications", "inApp"],
			["suppressActiveSession", "suppressActive"]
		]);
		/** Toast duration bounds, matching the Host's normalization. */
		const TOAST_HOLD_MIN_MS = 1e3;
		const TOAST_HOLD_MAX_MS = 3e4;
		/** Longest template the editor accepts, matching the Host's storage cap. */
		const MAX_TEMPLATE_LENGTH = 200;
		/** Placeholder syntax: `{{app}}`, `{{ event }}`, … */
		const PLACEHOLDER = /\{\{\s*([a-zA-Z][\w-]*)\s*\}\}/g;
		const COPY = {
			zh: {
				nav: "通知",
				contentHeading: "通知内容",
				contentIntro: "标题和正文共同组成通知文本，可以混排下方预设。",
				titleLabel: "标题",
				bodyLabel: "正文",
				presets: "可用预设",
				presetLabels: {
					app: "应用名",
					event: "事件",
					session: "会话标题",
					workspace: "工作区名",
					detail: "内容"
				},
				sample: {
					event: "任务完成",
					session: "修复登录问题",
					workspace: "dsh-tada",
					detail: "本轮对话已处理完毕"
				},
				preview: "预览",
				toastHeading: "应用内提醒",
				toastIntro: "当 DSH 在前台但停留在其他会话时，提醒会以 toast 显示。",
				dismissLabel: "关闭方式",
				autoLabel: "自动消失",
				autoHint: "显示一段时间后自动淡出",
				manualLabel: "手动关闭",
				manualHint: "一直显示，直到点击「关闭」或打开会话",
				durationLabel: "显示时长",
				secondsUnit: "秒",
				durationHint: "1–30 秒，默认 5 秒",
				durationOff: "手动关闭模式下不生效",
				invalidSeconds: "请输入 1–30 之间的秒数",
				toastPreview: "TOAST 预览",
				toastOpen: "查看",
				toastClose: "关闭",
				previewAuto: "{seconds} 秒后自动消失",
				previewManual: "不会自动消失，点击「关闭」收起",
				save: "保存",
				saving: "保存中…",
				saved: "已保存",
				reset: "恢复默认",
				failed: "保存失败，请重试",
				loadFailed: "读取设置失败，当前显示的是默认值",
				behaviorHeading: "通知行为",
				behaviorIntro: "控制是否提醒，以及哪些事件会触发提醒。",
				masterLabel: "启用通知",
				masterHint: "关闭后不再发送系统或应用内提醒",
				eventsLabel: "事件通知",
				events: {
					turnEnd: {
						label: "轮次结束",
						hint: "每轮对话完成时提醒"
					},
					error: {
						label: "出错",
						hint: "任务或工具执行失败时提醒"
					},
					approval: {
						label: "等待批准",
						hint: "需要你批准操作时提醒"
					},
					question: {
						label: "等待回答",
						hint: "需要你回答问题或选择时提醒"
					},
					subagentEnd: {
						label: "子任务结束",
						hint: "子代理任务完成时提醒"
					},
					workflowEnd: {
						label: "工作流结束",
						hint: "工作流运行完成时提醒"
					},
					goalComplete: {
						label: "目标完成",
						hint: "长期目标完成时提醒"
					}
				},
				otherLabel: "其他",
				notifySubagentSessionsLabel: "子会话通知",
				notifySubagentSessionsHint: "子代理会话中的提醒也照常送达",
				includePreviewLabel: "附带内容预览",
				includePreviewHint: "通知正文包含回复内容摘要",
				advancedHeading: "高级",
				advancedIntro: "调整通知通道、内容格式与提醒频率。",
				channelsLabel: "通知通道",
				channels: {
					web: {
						label: "系统通知",
						hint: "在桌面系统上弹出通知横幅"
					},
					inApp: {
						label: "应用内提醒",
						hint: "在 DSH 页面内显示 toast"
					},
					suppressActive: {
						label: "当前会话静默",
						hint: "正在查看的会话完成时不重复提醒"
					}
				},
				appNameLabel: "应用名",
				appNameHint: "通知中 {{app}} 预设显示的名称",
				languageLabel: "语言",
				languageHint: "通知正文使用的语言",
				languageAuto: "跟随应用",
				languageZh: "中文",
				languageEn: "English",
				quietHoursLabel: "免打扰时段",
				quietHoursPlaceholder: "22:00-08:00",
				quietHoursHint: "留空表示不启用；格式 HH:MM-HH:MM，支持跨夜",
				minIntervalLabel: "最小提醒间隔",
				minIntervalUnit: "毫秒",
				minIntervalHint: "0–600000 毫秒，避免提醒过于频繁",
				bodyMaxLengthLabel: "正文最大长度",
				bodyMaxLengthHint: "20–500 个字符"
			},
			en: {
				nav: "Notifications",
				contentHeading: "Notification content",
				contentIntro: "The title and body form the notification text; mix in the presets below.",
				titleLabel: "Title",
				bodyLabel: "Body",
				presets: "Presets",
				presetLabels: {
					app: "App name",
					event: "Event",
					session: "Session title",
					workspace: "Workspace",
					detail: "Content"
				},
				sample: {
					event: "Turn complete",
					session: "Fix login bug",
					workspace: "dsh-tada",
					detail: "The turn finished."
				},
				preview: "Preview",
				toastHeading: "In-app toast",
				toastIntro: "While DSH is focused on another conversation, alerts appear as an in-app toast.",
				dismissLabel: "Dismissal",
				autoLabel: "Auto-dismiss",
				autoHint: "Fades out after the duration below",
				manualLabel: "Manual dismiss",
				manualHint: "Stays until you click Dismiss or open the Session",
				durationLabel: "Duration",
				secondsUnit: "s",
				durationHint: "1–30 seconds, 5 s by default",
				durationOff: "Not used in manual mode",
				invalidSeconds: "Enter a duration between 1 and 30 seconds",
				toastPreview: "TOAST PREVIEW",
				toastOpen: "Open",
				toastClose: "Dismiss",
				previewAuto: "Disappears after {seconds}s",
				previewManual: "Stays until dismissed",
				save: "Save",
				saving: "Saving…",
				saved: "Saved",
				reset: "Restore defaults",
				failed: "Save failed, please retry",
				loadFailed: "Could not load the settings; showing the defaults",
				behaviorHeading: "Notification behavior",
				behaviorIntro: "Control whether alerts are delivered and which events can trigger them.",
				masterLabel: "Enable notifications",
				masterHint: "Off means no system or in-app alerts at all",
				eventsLabel: "Event alerts",
				events: {
					turnEnd: {
						label: "Turn complete",
						hint: "Alert when a turn finishes"
					},
					error: {
						label: "Errors",
						hint: "Alert when a task or tool fails"
					},
					approval: {
						label: "Approval needed",
						hint: "Alert when your approval is required"
					},
					question: {
						label: "Question asked",
						hint: "Alert when a question needs your answer"
					},
					subagentEnd: {
						label: "Subagent finished",
						hint: "Alert when a subagent task completes"
					},
					workflowEnd: {
						label: "Workflow finished",
						hint: "Alert when a workflow run completes"
					},
					goalComplete: {
						label: "Goal complete",
						hint: "Alert when a long-running goal is achieved"
					}
				},
				otherLabel: "Other",
				notifySubagentSessionsLabel: "Subagent-session alerts",
				notifySubagentSessionsHint: "Deliver alerts raised inside subagent sessions too",
				includePreviewLabel: "Include content preview",
				includePreviewHint: "The notification body carries a reply excerpt",
				advancedHeading: "Advanced",
				advancedIntro: "Adjust delivery channels, content format, and alert frequency.",
				channelsLabel: "Delivery channels",
				channels: {
					web: {
						label: "System notifications",
						hint: "Show desktop notification banners"
					},
					inApp: {
						label: "In-app alerts",
						hint: "Show an in-app toast inside DSH"
					},
					suppressActive: {
						label: "Silence the open session",
						hint: "No alert for the Session you are already viewing"
					}
				},
				appNameLabel: "App name",
				appNameHint: "Shown where templates use the {{app}} preset",
				languageLabel: "Language",
				languageHint: "Language of the notification text",
				languageAuto: "Follow the app",
				languageZh: "中文",
				languageEn: "English",
				quietHoursLabel: "Quiet hours",
				quietHoursPlaceholder: "22:00-08:00",
				quietHoursHint: "Leave empty to disable; HH:MM-HH:MM, overnight windows are fine",
				minIntervalLabel: "Minimum interval",
				minIntervalUnit: "ms",
				minIntervalHint: "0–600000 ms, avoids alert flooding",
				bodyMaxLengthLabel: "Maximum body length",
				bodyMaxLengthHint: "20–500 characters"
			}
		};
		const CSS = [
			".tada-settings{display:flex;flex-direction:column;gap:16px;padding:2px 0 24px;max-width:720px;color:var(--dsw-alias-label-primary,#e6e6e6);font:400 14px/22px system-ui,-apple-system,sans-serif}",
			".tada-settings-card{display:flex;flex-direction:column;gap:12px;padding:14px 16px;border:1px solid var(--dsw-alias-border-l2,#3a3f46);border-radius:12px;background:var(--dsw-alias-bg-module-platform,rgba(127,127,127,.06))}",
			".tada-settings-field{display:flex;flex-direction:column;gap:7px}",
			".tada-settings-label{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-secondary,#c4c7cc);font-size:12px;font-weight:600;line-height:18px;letter-spacing:.02em}",
			".tada-settings-field input{box-sizing:border-box;width:100%;height:36px;border:1px solid var(--dsw-alias-border-l2,#3a3f46);background:var(--dsw-alias-bg-module-platform,rgba(127,127,127,.10));color:var(--dsw-alias-label-primary,#e6e6e6);font:13px/20px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;border-radius:8px;padding:0 11px;outline:none;transition:border-color .15s ease,box-shadow .15s ease}",
			".tada-settings-field input::placeholder{color:var(--dsw-alias-label-caption,#7f858d)}",
			".tada-settings-field input:focus{border-color:var(--dsw-static-deepseek-400,#5686fe);box-shadow:0 0 0 3px rgba(86,134,254,.18)}",
			".tada-settings-field input:disabled{opacity:.6;cursor:not-allowed}",
			".tada-settings-field select{box-sizing:border-box;width:100%;height:36px;border:1px solid var(--dsw-alias-border-l2,#3a3f46);background:var(--dsw-alias-bg-module-platform,rgba(127,127,127,.10));color:var(--dsw-alias-label-primary,#e6e6e6);font:13px/20px system-ui,-apple-system,sans-serif;border-radius:8px;padding:0 11px;outline:none;transition:border-color .15s ease,box-shadow .15s ease}",
			".tada-settings-field select:focus{border-color:var(--dsw-static-deepseek-400,#5686fe);box-shadow:0 0 0 3px rgba(86,134,254,.18)}",
			".tada-settings-field select:disabled{opacity:.6;cursor:not-allowed}",
			".tada-settings-divider{width:100%;height:0;margin:0;border:0;border-top:1px solid var(--dsw-alias-border-l2,#3a3f46);opacity:.85}",
			".tada-settings-presets{display:flex;flex-direction:column;gap:8px}",
			".tada-settings-preset-list{display:flex;flex-wrap:wrap;gap:8px}",
			".tada-settings-preset{display:inline-flex;align-items:baseline;gap:6px;padding:4px 10px;border:1px solid var(--dsw-alias-border-l2,#3a3f46);border-radius:999px;background:var(--dsw-alias-bg-module-platform,rgba(127,127,127,.08));font-size:12px;line-height:18px}",
			".tada-settings-preset code{font:12px/18px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--dsw-static-deepseek-400,#5686fe)}",
			".tada-settings-preset-label{color:var(--dsw-alias-label-caption,#7f858d)}",
			".tada-settings-preview{display:flex;flex-direction:column;gap:5px;padding:12px 16px;border:1px solid var(--dsw-alias-border-l2,#3a3f46);border-radius:12px;background:var(--dsw-alias-bg-layer-2,#1c2128)}",
			".tada-settings-preview-caption{color:var(--dsw-alias-label-caption,#7f858d);font-size:11px;line-height:16px;letter-spacing:.04em}",
			".tada-settings-preview-title{color:var(--dsw-alias-label-primary,#e6e6e6);font-size:14px;font-weight:600;line-height:21px;word-break:break-word}",
			".tada-settings-preview-body{color:var(--dsw-alias-label-secondary,#c4c7cc);font-size:13px;line-height:20px;word-break:break-word}",
			".tada-settings-heading{color:var(--dsw-alias-label-primary,#e6e6e6);font-size:13px;font-weight:600;line-height:20px}",
			".tada-settings-desc{margin:0;color:var(--dsw-alias-label-caption,#7f858d);font-size:12px;line-height:18px}",
			".tada-settings-choice{display:flex;flex-wrap:wrap;gap:10px}",
			".tada-settings-choice-btn{box-sizing:border-box;flex:1 1 220px;display:flex;flex-direction:column;align-items:flex-start;gap:3px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2,#3a3f46);border-radius:10px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;transition:border-color .15s ease,background .15s ease,box-shadow .15s ease}",
			".tada-settings-choice-btn:hover:not(:disabled){background:var(--dsw-alias-bg-module-platform,rgba(127,127,127,.10))}",
			".tada-settings-choice-btn[aria-pressed=\"true\"]{border-color:var(--dsw-static-deepseek-400,#5686fe);background:rgba(86,134,254,.12);box-shadow:inset 0 0 0 1px var(--dsw-static-deepseek-400,#5686fe)}",
			".tada-settings-choice-btn:disabled{opacity:.6;cursor:not-allowed}",
			".tada-settings-choice-label{color:var(--dsw-alias-label-primary,#e6e6e6);font-size:13px;font-weight:600;line-height:20px}",
			".tada-settings-choice-hint{color:var(--dsw-alias-label-caption,#7f858d);font-size:12px;line-height:18px}",
			".tada-settings-group-label{color:var(--dsw-alias-label-secondary,#c4c7cc);font-size:12px;font-weight:600;line-height:18px;letter-spacing:.02em}",
			".tada-settings-switch-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px}",
			".tada-settings-switch-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 12px;border:1px solid var(--dsw-alias-border-l2,#3a3f46);border-radius:10px;background:var(--dsw-alias-bg-module-platform,rgba(127,127,127,.06))}",
			".tada-settings-switch-text{display:flex;flex-direction:column;gap:2px;min-width:0}",
			".tada-settings-switch{box-sizing:border-box;flex:none;position:relative;width:38px;height:22px;padding:0;border:1px solid var(--dsw-alias-border-l2,#3a3f46);border-radius:999px;background:var(--dsw-alias-bg-layer-2,#1c2128);cursor:pointer;transition:background .15s ease,border-color .15s ease}",
			".tada-settings-switch[aria-checked=\"true\"]{border-color:var(--dsw-static-deepseek-400,#5686fe);background:var(--dsw-static-deepseek-400,#5686fe)}",
			".tada-settings-switch:disabled{opacity:.6;cursor:not-allowed}",
			".tada-settings-switch-thumb{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .15s ease}",
			".tada-settings-switch[aria-checked=\"true\"] .tada-settings-switch-thumb{transform:translateX(16px)}",
			".tada-settings-config-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}",
			".tada-settings-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}",
			".tada-settings-field .tada-settings-number{width:112px;flex:none}",
			".tada-settings-unit{color:var(--dsw-alias-label-secondary,#c4c7cc);font-size:13px;line-height:20px}",
			".tada-settings-hint{color:var(--dsw-alias-label-caption,#7f858d);font-size:12px;line-height:18px}",
			".tada-settings-hint-error{color:var(--dsw-alias-label-error,#e5484d)}",
			".tada-settings-toast-preview{display:flex;flex-direction:column;gap:1px;max-width:100%;padding:10px 14px;border-radius:10px;background:var(--dsw-alias-toast-bg,#2c2c2e);color:var(--dsw-alias-toast-label,#fff);box-shadow:var(--dsw-shadow-lv3,0 8px 24px #00000033);font-size:13px;line-height:20px}",
			".tada-settings-toast-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}",
			".tada-settings-toast-row{display:flex;align-items:center;gap:8px;min-width:0}",
			".tada-settings-toast-body{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-toast-label,#fff);opacity:.82}",
			".tada-settings-toast-actions{flex:none;color:var(--dsw-static-deepseek-400,#5686fe);white-space:nowrap}",
			TOAST_NEWLINE_CSS,
			".tada-settings-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}",
			".tada-settings-btn{box-sizing:border-box;font:inherit;font-size:13px;font-weight:500;line-height:30px;height:30px;border-radius:8px;border:1px solid transparent;padding:0 15px;cursor:pointer;transition:background .15s ease,border-color .15s ease,opacity .15s ease}",
			".tada-settings-btn-primary{background:var(--dsw-static-deepseek-400,#5686fe);color:#fff}",
			".tada-settings-btn-primary:hover:not(:disabled){background:var(--dsw-static-deepseek-500,#4574e8)}",
			".tada-settings-btn-primary:disabled{opacity:.6;cursor:not-allowed}",
			".tada-settings-btn-ghost{background:transparent;color:var(--dsw-alias-label-secondary,#c4c7cc);border-color:var(--dsw-alias-border-l2,#3a3f46)}",
			".tada-settings-btn-ghost:hover:not(:disabled){background:var(--dsw-alias-bg-module-platform,rgba(127,127,127,.10))}",
			".tada-settings-msg{color:var(--dsw-alias-label-tertiary,#9aa0a6);font-size:12px;line-height:18px;min-height:18px}"
		].join("");
		function ensureStyle() {
			try {
				if (typeof document === "undefined" || !document.head || typeof document.createElement !== "function") return;
				const existing = typeof document.head.querySelector === "function" ? document.head.querySelector("style[data-plugin-css=\"dsh-tada\"]") : null;
				if (existing) {
					if (existing.textContent !== CSS) existing.textContent = CSS;
					return;
				}
				const tag = document.createElement("style");
				tag.setAttribute("data-plugin-css", "dsh-tada");
				tag.textContent = CSS;
				document.head.appendChild(tag);
			} catch {}
		}
		/** Active page language: the GUI keeps `<html lang>` current for us. */
		function pageLanguage() {
			try {
				const lang = (typeof document !== "undefined" && document.documentElement ? document.documentElement.lang : "") || "";
				if (/^zh/i.test(lang)) return "zh";
				if (lang !== "") return "en";
			} catch {}
			try {
				const nav = typeof navigator !== "undefined" && typeof navigator.language === "string" ? navigator.language : "";
				return /^zh/i.test(nav) ? "zh" : "en";
			} catch {
				return "en";
			}
		}
		function copy() {
			return COPY[pageLanguage()];
		}
		/** Accept the Host's templates, restoring each missing part's default. */
		function normalizeDisplay(value, defaults = DEFAULT_DISPLAY) {
			const template = (candidate, fallback) => typeof candidate === "string" && candidate.trim() !== "" ? candidate.slice(0, MAX_TEMPLATE_LENGTH) : fallback;
			return {
				title: template(value?.title, defaults.title),
				body: template(value?.body, defaults.body)
			};
		}
		function normalizePresets(value) {
			const presets = Array.isArray(value) ? value.filter((id) => typeof id === "string" && id !== "") : [];
			return presets.length > 0 ? presets : [...FALLBACK_PRESETS];
		}
		/** Format a hold duration as the seconds value the number input edits. */
		function formatSeconds(holdMs) {
			const seconds = holdMs / 1e3;
			return Number.isInteger(seconds) ? String(seconds) : String(Number(seconds.toFixed(2)));
		}
		/** Parse the seconds input back to milliseconds, falling back when invalid. */
		function holdMsOf(secondsText, fallback) {
			const seconds = Number(secondsText);
			return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1e3) : fallback;
		}
		/** Toast behavior as this page edits it: the mode plus seconds as text. */
		function normalizeToast(value, fallback = DEFAULT_TOAST) {
			const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
			const fallbackDismiss = fallback.dismiss === "manual" ? "manual" : "auto";
			const dismiss = source.dismiss === "manual" ? "manual" : source.dismiss === "auto" ? "auto" : fallbackDismiss;
			const fallbackHold = Number.isFinite(Number(fallback.holdMs)) ? Number(fallback.holdMs) : Number(fallback.seconds) * 1e3;
			const sourceHold = Number(source.holdMs);
			const hold = Number.isFinite(sourceHold) ? sourceHold : Number.isFinite(fallbackHold) ? fallbackHold : DEFAULT_TOAST.holdMs;
			return {
				dismiss,
				seconds: formatSeconds(Math.min(TOAST_HOLD_MAX_MS, Math.max(TOAST_HOLD_MIN_MS, Math.round(hold))))
			};
		}
		/** Coerce a Config boolean; a malformed value keeps the fallback. */
		function boolValue(value, fallback) {
			if (typeof value === "boolean") return value;
			if (typeof value === "number") return value !== 0;
			if (typeof value === "string") {
				const text = value.trim().toLowerCase();
				if ([
					"1",
					"true",
					"yes",
					"on"
				].includes(text)) return true;
				if ([
					"0",
					"false",
					"no",
					"off"
				].includes(text)) return false;
			}
			return typeof fallback === "boolean" ? fallback : false;
		}
		/** Coerce a Config integer, clamped to [min, max]; malformed keeps the fallback. */
		function intValue(value, fallback, [min, max]) {
			if (typeof value === "string" && value.trim() === "") return fallback;
			const number = Number(value);
			if (!Number.isFinite(number)) return fallback;
			return Math.min(max, Math.max(min, Math.floor(number)));
		}
		/**
		* Local mirror of the Host's Config normalization: unknown keys are dropped,
		* booleans and numbers are coerced/clamped, malformed values fall back to the
		* supplied defaults (the Host's `configDefaults`, or the local mirror). The
		* draft values this page edits may be text (number inputs); saving normalizes
		* them back into the full object the Host expects.
		*/
		function normalizeConfig(value, defaults = CONFIG_DEFAULTS) {
			const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
			const fallback = defaults && typeof defaults === "object" && !Array.isArray(defaults) ? defaults : CONFIG_DEFAULTS;
			const appName = typeof input.appName === "string" ? input.appName.trim() : "";
			const language = typeof input.language === "string" ? input.language.trim().toLowerCase() : "";
			const dismiss = typeof input.inAppToastDismiss === "string" ? input.inAppToastDismiss.trim().toLowerCase() : "";
			const quietHours = typeof input.quietHours === "string" ? input.quietHours.trim() : "";
			return {
				enabled: boolValue(input.enabled, fallback.enabled),
				notifyOnTurnEnd: boolValue(input.notifyOnTurnEnd, fallback.notifyOnTurnEnd),
				notifyOnError: boolValue(input.notifyOnError, fallback.notifyOnError),
				notifyOnApproval: boolValue(input.notifyOnApproval, fallback.notifyOnApproval),
				notifyOnQuestion: boolValue(input.notifyOnQuestion, fallback.notifyOnQuestion),
				notifyOnSubagentEnd: boolValue(input.notifyOnSubagentEnd, fallback.notifyOnSubagentEnd),
				notifyOnWorkflowEnd: boolValue(input.notifyOnWorkflowEnd, fallback.notifyOnWorkflowEnd),
				notifyOnGoalComplete: boolValue(input.notifyOnGoalComplete, fallback.notifyOnGoalComplete),
				notifySubagentSessions: boolValue(input.notifySubagentSessions, fallback.notifySubagentSessions),
				includePreview: boolValue(input.includePreview, fallback.includePreview),
				webNotifications: boolValue(input.webNotifications, fallback.webNotifications),
				inAppNotifications: boolValue(input.inAppNotifications, fallback.inAppNotifications),
				suppressActiveSession: boolValue(input.suppressActiveSession, fallback.suppressActiveSession),
				inAppToastDismiss: dismiss === "auto" || dismiss === "manual" ? dismiss : fallback.inAppToastDismiss === "manual" ? "manual" : "auto",
				inAppHoldMs: intValue(input.inAppHoldMs, fallback.inAppHoldMs, [TOAST_HOLD_MIN_MS, TOAST_HOLD_MAX_MS]),
				appName: appName !== "" ? appName.slice(0, APP_NAME_MAX_LENGTH) : typeof fallback.appName === "string" && fallback.appName.trim() !== "" ? fallback.appName.trim().slice(0, APP_NAME_MAX_LENGTH) : CONFIG_DEFAULTS.appName,
				quietHours: typeof input.quietHours === "string" ? quietHours : typeof fallback.quietHours === "string" ? fallback.quietHours.trim() : "",
				minIntervalMs: intValue(input.minIntervalMs, fallback.minIntervalMs, CONFIG_LIMITS.minIntervalMs),
				bodyMaxLength: intValue(input.bodyMaxLength, fallback.bodyMaxLength, CONFIG_LIMITS.bodyMaxLength),
				language: CONFIG_LANGUAGES.includes(language) ? language : CONFIG_LANGUAGES.includes(fallback.language) ? fallback.language : "auto"
			};
		}
		/** Render one template with the preview sample; unknown presets stay visible. */
		function render(template, sample) {
			return String(template ?? "").replace(PLACEHOLDER, (token, id) => {
				const key = id.toLowerCase();
				return Object.prototype.hasOwnProperty.call(sample, key) ? sample[key] : token;
			}).replace(/\s+/g, " ").trim();
		}
		function TemplateField(props) {
			const { part, label, value, disabled, onChange } = props;
			return React.createElement("label", { className: "tada-settings-field" }, React.createElement("span", { className: "tada-settings-label" }, label), React.createElement("input", {
				type: "text",
				value,
				maxLength: MAX_TEMPLATE_LENGTH,
				placeholder: DEFAULT_DISPLAY[part],
				disabled,
				spellCheck: false,
				autoComplete: "off",
				onChange: (event) => onChange(part, event.target.value)
			}));
		}
		/** One option of the dismissal segmented control. */
		function ChoiceButton(props) {
			const { active, label, hint, disabled, onClick } = props;
			return React.createElement("button", {
				type: "button",
				className: "tada-settings-choice-btn",
				"aria-pressed": active,
				disabled,
				onClick
			}, React.createElement("span", { className: "tada-settings-choice-label" }, label), React.createElement("span", { className: "tada-settings-choice-hint" }, hint));
		}
		/** One Config switch: a label/hint block beside an accessible switch button. */
		function SwitchField(props) {
			const { label, hint, checked, disabled, onChange } = props;
			return React.createElement("div", { className: "tada-settings-switch-row" }, React.createElement("div", { className: "tada-settings-switch-text" }, React.createElement("span", { className: "tada-settings-choice-label" }, label), hint !== "" ? React.createElement("span", { className: "tada-settings-hint" }, hint) : null), React.createElement("button", {
				type: "button",
				role: "switch",
				className: "tada-settings-switch",
				"aria-checked": checked,
				"aria-label": label,
				disabled,
				onClick: () => onChange(!checked)
			}, React.createElement("span", { className: "tada-settings-switch-thumb" })));
		}
		/** One free-text Config field (app name, quiet hours). */
		function ConfigTextField(props) {
			const { label, hint, value, placeholder, maxLength, disabled, onChange } = props;
			return React.createElement("label", { className: "tada-settings-field" }, React.createElement("span", { className: "tada-settings-label" }, label), React.createElement("input", {
				type: "text",
				value,
				placeholder,
				maxLength,
				disabled,
				spellCheck: false,
				autoComplete: "off",
				"aria-label": label,
				onChange: (event) => onChange(event.target.value)
			}), hint !== "" ? React.createElement("span", { className: "tada-settings-hint" }, hint) : null);
		}
		/** One Config select (the notification language). */
		function ConfigSelectField(props) {
			const { label, hint, value, options, disabled, onChange } = props;
			return React.createElement("label", { className: "tada-settings-field" }, React.createElement("span", { className: "tada-settings-label" }, label), React.createElement("select", {
				value,
				disabled,
				"aria-label": label,
				onChange: (event) => onChange(event.target.value)
			}, options.map((option) => React.createElement("option", {
				key: option.value,
				value: option.value
			}, option.label))), hint !== "" ? React.createElement("span", { className: "tada-settings-hint" }, hint) : null);
		}
		/** One bounded Config number, with the Host-clamped range shown beside it. */
		function ConfigNumberField(props) {
			const { label, hint, value, min, max, unit, disabled, onChange } = props;
			return React.createElement("div", { className: "tada-settings-field" }, React.createElement("span", { className: "tada-settings-label" }, label), React.createElement("div", { className: "tada-settings-row" }, React.createElement("input", {
				type: "number",
				className: "tada-settings-number",
				min,
				max,
				step: 1,
				inputMode: "numeric",
				value,
				disabled,
				"aria-label": label,
				onChange: (event) => onChange(event.target.value)
			}), unit !== "" ? React.createElement("span", { className: "tada-settings-unit" }, unit) : null, React.createElement("span", { className: "tada-settings-hint" }, hint)));
		}
		function SettingsSection() {
			const [state, setState] = React.useState({
				status: "loading",
				display: DEFAULT_DISPLAY,
				defaults: DEFAULT_DISPLAY,
				presets: FALLBACK_PRESETS,
				toast: normalizeToast(DEFAULT_TOAST),
				toastDefaults: normalizeToast(DEFAULT_TOAST),
				config: { ...CONFIG_DEFAULTS },
				configDefaults: { ...CONFIG_DEFAULTS },
				saving: false,
				message: ""
			});
			const t = copy();
			const update = (patch) => setState((prev) => ({
				...prev,
				...patch
			}));
			React.useEffect(() => {
				let alive = true;
				ensureStyle();
				const load = async () => {
					try {
						const res = await fetch(SETTINGS_ROUTE, { headers: { accept: "application/json" } });
						if (!res.ok) throw new Error(`HTTP ${res.status}`);
						const data = await res.json();
						if (!alive) return;
						const defaults = normalizeDisplay(data?.defaults ?? DEFAULT_DISPLAY, DEFAULT_DISPLAY);
						const toastDefaults = normalizeToast(data?.toastDefaults ?? DEFAULT_TOAST, normalizeToast(DEFAULT_TOAST));
						const configDefaults = normalizeConfig(data?.configDefaults, CONFIG_DEFAULTS);
						const configSource = data?.config && typeof data.config === "object" && !Array.isArray(data.config) ? data.config : { ...configDefaults };
						update({
							status: "ready",
							display: normalizeDisplay(data?.display ?? defaults, defaults),
							defaults,
							presets: normalizePresets(data?.presets),
							toast: normalizeToast(data?.toast ?? toastDefaults, toastDefaults),
							toastDefaults,
							config: normalizeConfig(configSource, configDefaults),
							configDefaults,
							message: ""
						});
					} catch {
						if (!alive) return;
						update({
							status: "error",
							display: DEFAULT_DISPLAY,
							defaults: DEFAULT_DISPLAY,
							presets: FALLBACK_PRESETS,
							toast: normalizeToast(DEFAULT_TOAST),
							toastDefaults: normalizeToast(DEFAULT_TOAST),
							config: { ...CONFIG_DEFAULTS },
							configDefaults: { ...CONFIG_DEFAULTS },
							message: t.loadFailed
						});
					}
				};
				load();
				return () => {
					alive = false;
				};
			}, []);
			const setTemplate = (part, value) => {
				update({
					display: {
						...state.display,
						[part]: value
					},
					message: ""
				});
			};
			const setToast = (patch) => {
				update({
					toast: {
						...state.toast,
						...patch
					},
					message: ""
				});
			};
			const setConfig = (patch) => {
				update({
					config: {
						...state.config,
						...patch
					},
					message: ""
				});
			};
			const seconds = Number(state.toast.seconds);
			const secondsValid = state.toast.seconds.trim() !== "" && Number.isFinite(seconds) && seconds >= TOAST_HOLD_MIN_MS / 1e3 && seconds <= TOAST_HOLD_MAX_MS / 1e3;
			const manual = state.toast.dismiss === "manual";
			const sentHoldMs = secondsValid ? Math.round(seconds * 1e3) : holdMsOf(state.toastDefaults.seconds, DEFAULT_TOAST.holdMs);
			const save = async () => {
				if (state.saving || !manual && !secondsValid) return;
				update({
					saving: true,
					message: ""
				});
				const config = normalizeConfig({
					...state.config,
					inAppToastDismiss: state.toast.dismiss,
					inAppHoldMs: sentHoldMs
				}, state.configDefaults);
				try {
					const res = await fetch(SETTINGS_ROUTE, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							display: state.display,
							toast: {
								dismiss: state.toast.dismiss,
								holdMs: sentHoldMs
							},
							config
						})
					});
					if (!res.ok) throw new Error(`HTTP ${res.status}`);
					const data = await res.json().catch(() => ({}));
					update({
						display: normalizeDisplay(data?.display ?? state.display, state.defaults),
						toast: normalizeToast(data?.toast ?? {
							dismiss: state.toast.dismiss,
							holdMs: sentHoldMs
						}, state.toastDefaults),
						config: normalizeConfig(data?.config ?? config, state.configDefaults),
						saving: false,
						message: t.saved
					});
				} catch {
					update({
						saving: false,
						message: t.failed
					});
				}
			};
			const disabled = state.status === "loading" || state.saving;
			const sample = {
				...t.sample,
				app: state.config.appName
			};
			const previewTitle = render(state.display.title, sample) || `${sample.app} · ${sample.event}`;
			const previewBody = render(state.display.body, sample) || sample.detail;
			const durationInvalid = !manual && !secondsValid;
			const durationHint = manual ? t.durationOff : secondsValid ? t.durationHint : t.invalidSeconds;
			const previewSeconds = secondsValid ? state.toast.seconds : state.toastDefaults.seconds;
			const config = state.config;
			const languageOptions = [
				{
					value: "auto",
					label: t.languageAuto
				},
				{
					value: "zh",
					label: t.languageZh
				},
				{
					value: "en",
					label: t.languageEn
				}
			];
			return React.createElement("div", { className: "tada-settings" }, React.createElement("div", { className: "tada-settings-card" }, React.createElement("div", { className: "tada-settings-heading" }, t.contentHeading), React.createElement("p", { className: "tada-settings-desc" }, t.contentIntro), React.createElement(TemplateField, {
				part: "title",
				label: t.titleLabel,
				value: state.display.title,
				disabled,
				onChange: setTemplate
			}), React.createElement("hr", { className: "tada-settings-divider" }), React.createElement(TemplateField, {
				part: "body",
				label: t.bodyLabel,
				value: state.display.body,
				disabled,
				onChange: setTemplate
			}), React.createElement("hr", { className: "tada-settings-divider" }), React.createElement("div", { className: "tada-settings-presets" }, React.createElement("span", { className: "tada-settings-label" }, t.presets), React.createElement("div", { className: "tada-settings-preset-list" }, state.presets.map((id) => React.createElement("span", {
				key: id,
				className: "tada-settings-preset"
			}, React.createElement("code", null, `{{${id}}}`), React.createElement("span", { className: "tada-settings-preset-label" }, t.presetLabels[id] ?? id))))), React.createElement("div", { className: "tada-settings-preview" }, React.createElement("span", { className: "tada-settings-preview-caption" }, t.preview), React.createElement("span", { className: "tada-settings-preview-title" }, previewTitle), React.createElement("span", { className: "tada-settings-preview-body" }, previewBody))), React.createElement("div", { className: "tada-settings-card" }, React.createElement("div", { className: "tada-settings-heading" }, t.toastHeading), React.createElement("p", { className: "tada-settings-desc" }, t.toastIntro), React.createElement("div", { className: "tada-settings-field" }, React.createElement("span", { className: "tada-settings-label" }, t.dismissLabel), React.createElement("div", {
				className: "tada-settings-choice",
				role: "group",
				"aria-label": t.dismissLabel
			}, React.createElement(ChoiceButton, {
				active: !manual,
				label: t.autoLabel,
				hint: t.autoHint,
				disabled,
				onClick: () => setToast({ dismiss: "auto" })
			}), React.createElement(ChoiceButton, {
				active: manual,
				label: t.manualLabel,
				hint: t.manualHint,
				disabled,
				onClick: () => setToast({ dismiss: "manual" })
			}))), React.createElement("hr", { className: "tada-settings-divider" }), React.createElement("div", { className: "tada-settings-field" }, React.createElement("span", { className: "tada-settings-label" }, t.durationLabel), React.createElement("div", { className: "tada-settings-row" }, React.createElement("input", {
				type: "number",
				className: "tada-settings-number",
				min: TOAST_HOLD_MIN_MS / 1e3,
				max: TOAST_HOLD_MAX_MS / 1e3,
				step: 1,
				inputMode: "numeric",
				value: state.toast.seconds,
				disabled: disabled || manual,
				"aria-label": t.durationLabel,
				"aria-invalid": durationInvalid,
				onChange: (event) => setToast({ seconds: event.target.value })
			}), React.createElement("span", { className: "tada-settings-unit" }, t.secondsUnit), React.createElement("span", { className: `tada-settings-hint${durationInvalid ? " tada-settings-hint-error" : ""}` }, durationHint))), React.createElement("div", { className: "tada-settings-preview" }, React.createElement("span", { className: "tada-settings-preview-caption" }, t.toastPreview), React.createElement("div", { className: "tada-settings-toast-preview" }, React.createElement("span", { className: "tada-settings-toast-title" }, previewTitle), React.createElement("div", { className: "tada-settings-toast-row" }, React.createElement("span", { className: "tada-settings-toast-body" }, previewBody), React.createElement("span", { className: "tada-settings-toast-actions" }, manual ? `${t.toastOpen} · ${t.toastClose}` : t.toastOpen))), React.createElement("span", { className: "tada-settings-hint" }, manual ? t.previewManual : t.previewAuto.replace("{seconds}", previewSeconds)))), React.createElement("div", { className: "tada-settings-card" }, React.createElement("div", { className: "tada-settings-heading" }, t.behaviorHeading), React.createElement("p", { className: "tada-settings-desc" }, t.behaviorIntro), React.createElement(SwitchField, {
				label: t.masterLabel,
				hint: t.masterHint,
				checked: config.enabled,
				disabled,
				onChange: (value) => setConfig({ enabled: value })
			}), React.createElement("hr", { className: "tada-settings-divider" }), React.createElement("div", { className: "tada-settings-field" }, React.createElement("span", { className: "tada-settings-group-label" }, t.eventsLabel), React.createElement("div", { className: "tada-settings-switch-grid" }, EVENT_SWITCHES.map(([key, id]) => React.createElement(SwitchField, {
				key,
				label: t.events[id].label,
				hint: t.events[id].hint,
				checked: config[key],
				disabled,
				onChange: (value) => setConfig({ [key]: value })
			})))), React.createElement("hr", { className: "tada-settings-divider" }), React.createElement("div", { className: "tada-settings-field" }, React.createElement("span", { className: "tada-settings-group-label" }, t.otherLabel), React.createElement("div", { className: "tada-settings-switch-grid" }, React.createElement(SwitchField, {
				label: t.notifySubagentSessionsLabel,
				hint: t.notifySubagentSessionsHint,
				checked: config.notifySubagentSessions,
				disabled,
				onChange: (value) => setConfig({ notifySubagentSessions: value })
			}), React.createElement(SwitchField, {
				label: t.includePreviewLabel,
				hint: t.includePreviewHint,
				checked: config.includePreview,
				disabled,
				onChange: (value) => setConfig({ includePreview: value })
			})))), React.createElement("div", { className: "tada-settings-card" }, React.createElement("div", { className: "tada-settings-heading" }, t.advancedHeading), React.createElement("p", { className: "tada-settings-desc" }, t.advancedIntro), React.createElement("div", { className: "tada-settings-field" }, React.createElement("span", { className: "tada-settings-group-label" }, t.channelsLabel), React.createElement("div", { className: "tada-settings-switch-grid" }, CHANNEL_SWITCHES.map(([key, id]) => React.createElement(SwitchField, {
				key,
				label: t.channels[id].label,
				hint: t.channels[id].hint,
				checked: config[key],
				disabled,
				onChange: (value) => setConfig({ [key]: value })
			})))), React.createElement("hr", { className: "tada-settings-divider" }), React.createElement("div", { className: "tada-settings-config-grid" }, React.createElement(ConfigTextField, {
				label: t.appNameLabel,
				hint: t.appNameHint,
				value: config.appName,
				maxLength: APP_NAME_MAX_LENGTH,
				disabled,
				onChange: (value) => setConfig({ appName: value })
			}), React.createElement(ConfigSelectField, {
				label: t.languageLabel,
				hint: t.languageHint,
				value: config.language,
				options: languageOptions,
				disabled,
				onChange: (value) => setConfig({ language: value })
			})), React.createElement("div", { className: "tada-settings-config-grid" }, React.createElement(ConfigTextField, {
				label: t.quietHoursLabel,
				hint: t.quietHoursHint,
				value: config.quietHours,
				placeholder: t.quietHoursPlaceholder,
				maxLength: 11,
				disabled,
				onChange: (value) => setConfig({ quietHours: value })
			}), React.createElement(ConfigNumberField, {
				label: t.minIntervalLabel,
				hint: t.minIntervalHint,
				value: config.minIntervalMs,
				min: CONFIG_LIMITS.minIntervalMs[0],
				max: CONFIG_LIMITS.minIntervalMs[1],
				unit: t.minIntervalUnit,
				disabled,
				onChange: (value) => setConfig({ minIntervalMs: value })
			}), React.createElement(ConfigNumberField, {
				label: t.bodyMaxLengthLabel,
				hint: t.bodyMaxLengthHint,
				value: config.bodyMaxLength,
				min: CONFIG_LIMITS.bodyMaxLength[0],
				max: CONFIG_LIMITS.bodyMaxLength[1],
				unit: "",
				disabled,
				onChange: (value) => setConfig({ bodyMaxLength: value })
			}))), React.createElement("div", { className: "tada-settings-actions" }, React.createElement("button", {
				type: "button",
				className: "tada-settings-btn tada-settings-btn-primary",
				disabled: disabled || durationInvalid,
				onClick: save
			}, state.saving ? t.saving : t.save), React.createElement("button", {
				type: "button",
				className: "tada-settings-btn tada-settings-btn-ghost",
				disabled,
				onClick: () => update({
					display: { ...state.defaults },
					toast: { ...state.toastDefaults },
					config: { ...state.configDefaults },
					message: ""
				})
			}, t.reset), React.createElement("span", { className: "tada-settings-msg" }, state.message)));
		}
		/**
		* Register the "Notifications" settings page (content templates, in-app toast
		* behavior, notification-behavior switches, and advanced Config fields) and
		* give its Settings-nav row the notification bell.
		*
		* `icon` is the forward-compatible hint for hosts that render section icons;
		* hosts that only fall back to the generic gear are handled by nav-icon.js,
		* which swaps the glyph on the rendered row. Returns the disposer; on a page
		* without React or the settings slots the plugin simply has no page.
		*/
		function registerSettingsSection(ctx) {
			if (!React || typeof React.createElement !== "function") return () => {};
			const slots = service(ctx, "slots");
			if (!slots || typeof slots.inject !== "function" || typeof slots.register !== "function") return () => {};
			try {
				const disposeSection = slots.inject("settings.section", () => {
					ensureStyle();
					return slots.register({
						name: "settings.section",
						id: "dsh-tada-content",
						order: 30,
						label: () => copy().nav,
						icon: "bell"
					}, () => React.createElement(SettingsSection));
				});
				const disposeNavIcon = installNotificationNavIcon(() => copy().nav);
				return () => {
					try {
						disposeNavIcon();
					} catch {}
					disposeSection();
				};
			} catch {
				return () => {};
			}
		}
		// src/client/apply.js
		function apply(ctx) {
			try {
				ctx.effect(() => {
					if (typeof window === "undefined") return () => {};
					let stopped = false;
					let source = null;
					let reconnectTimer = null;
					let permissionTimer = null;
					let reportTimer = null;
					let lastPermission = permission();
					let lastReported = "";
					const clientId = createClientId();
					let activeSessionId = readActiveSession(ctx);
					let focused = isPageFocused();
					const toast = createToastPresenter(ctx);
					const disposeSettings = registerSettingsSection(ctx);
					function reportPermission() {
						const current = permission();
						return current === "granted" || current === "denied" ? current : "default";
					}
					function reportState(force = false) {
						if (stopped) return;
						const snapshot = {
							clientId,
							focused,
							activeSessionId,
							permission: reportPermission(),
							page: pageLabel()
						};
						let serialized;
						try {
							serialized = JSON.stringify(snapshot);
						} catch {
							return;
						}
						if (!force && serialized === lastReported) return;
						lastReported = serialized;
						try {
							if (typeof fetch !== "function") return;
							const pending = fetch(STATE_ROUTE, {
								method: "POST",
								headers: { "Content-Type": "application/json" },
								body: serialized,
								keepalive: true
							});
							if (pending && typeof pending.catch === "function") pending.catch(() => {});
						} catch {}
					}
					function scheduleReport() {
						if (stopped || reportTimer !== null) return;
						reportTimer = setTimeout(() => {
							reportTimer = null;
							reportState();
						}, 40);
					}
					function refreshActiveSession() {
						const next = readActiveSession(ctx);
						if (next === activeSessionId) return;
						activeSessionId = next;
						scheduleReport();
					}
					function scheduleReconnect() {
						if (stopped || reconnectTimer !== null) return;
						reconnectTimer = setTimeout(() => {
							reconnectTimer = null;
							connect();
						}, 3e3);
					}
					function disconnect() {
						if (source) {
							try {
								source.close();
							} catch {}
							source = null;
						}
					}
					function connect() {
						if (stopped || typeof EventSource === "undefined") return;
						lastPermission = permission();
						const query = new URLSearchParams();
						query.set("permission", reportPermission());
						query.set("page", pageLabel());
						query.set("clientId", clientId);
						query.set("focused", focused ? "1" : "0");
						if (activeSessionId) query.set("sessionId", activeSessionId);
						let next;
						try {
							next = new EventSource(`${EVENTS_ROUTE}?${query.toString()}`);
						} catch {
							scheduleReconnect();
							return;
						}
						source = next;
						next.addEventListener("message", (event) => {
							if (stopped) return;
							let payload;
							try {
								payload = JSON.parse(event.data);
							} catch {
								return;
							}
							present(ctx, toast, payload);
						});
						next.addEventListener("error", () => {
							if (stopped) return;
							disconnect();
							scheduleReconnect();
						});
						reportState(true);
					}
					function ensurePermission() {
						if (permission() !== "default") return;
						requestPermission().then(() => {
							if (stopped) return;
							if (permission() !== lastPermission) {
								lastPermission = permission();
								reportState();
							}
						});
					}
					function onGesture() {
						ensurePermission();
					}
					function onFocus() {
						focused = true;
						scheduleReport();
						refreshActiveSession();
					}
					function onBlur() {
						focused = isPageFocused();
						scheduleReport();
					}
					function onVisibility() {
						focused = isPageFocused();
						refreshActiveSession();
						scheduleReport();
					}
					window.addEventListener("focus", onFocus);
					window.addEventListener("blur", onBlur);
					window.addEventListener("pointerdown", onGesture, true);
					window.addEventListener("keydown", onGesture, true);
					window.addEventListener("pageshow", onVisibility);
					if (typeof document !== "undefined" && typeof document.addEventListener === "function") document.addEventListener("visibilitychange", onVisibility);
					const unwatchSessions = watchActiveSession(ctx, (next) => {
						if (next === activeSessionId) return;
						activeSessionId = next;
						scheduleReport();
					});
					if (lastPermission === "default") ensurePermission();
					connect();
					permissionTimer = setInterval(() => {
						if (stopped) return;
						const current = permission();
						if (current !== lastPermission) {
							lastPermission = current;
							if (current === "default") ensurePermission();
							reportState(true);
						}
						refreshActiveSession();
					}, 4e3);
					return () => {
						stopped = true;
						if (permissionTimer !== null) clearInterval(permissionTimer);
						if (reconnectTimer !== null) clearTimeout(reconnectTimer);
						if (reportTimer !== null) clearTimeout(reportTimer);
						try {
							unwatchSessions();
						} catch {}
						disconnect();
						toast.dispose();
						try {
							disposeSettings();
						} catch {}
						window.removeEventListener("focus", onFocus);
						window.removeEventListener("blur", onBlur);
						window.removeEventListener("pointerdown", onGesture, true);
						window.removeEventListener("keydown", onGesture, true);
						window.removeEventListener("pageshow", onVisibility);
						if (typeof document !== "undefined" && typeof document.removeEventListener === "function") document.removeEventListener("visibilitychange", onVisibility);
					};
				});
			} catch (error) {
				try {
					console.error("[dsh-tada] client initialization failed:", error);
				} catch {}
			}
		}
		// src/client/index.js
		/** Services the loader injects before materializing this client plugin. */
		const inject = ["slots"];
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
