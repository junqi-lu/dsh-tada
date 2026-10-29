# dsh-tada

Native desktop notifications for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), installed as a regular DSH plugin.

**English** | [Chinese](README.zh.md)

When an Agent finishes a turn, fails, needs your approval, or asks a question, dsh-tada alerts you in the least intrusive way:

| Where you are | What you get |
|---|---|
| Reading the conversation that just finished | Nothing — it is already on screen |
| In DSH, reading another conversation | In-app toast |
| In another app | System notification |

Notifications are raised by DeepSeek Harness itself, so the OS notification center shows DSH's name and icon, and clicking a notification opens the exact Session. The plugin patches nothing in DSH and has no runtime dependencies. It works in the Desktop app and in `dsh web`.

Every alert is driven by a DSH event the plugin observes; no notification depends on the model deciding to ping you.

## Install

```sh
dsh plugin --profile desktop add dsh-tada   # Desktop app
dsh plugin --profile web add dsh-tada       # dsh web profile
```

Pin a version with `dsh-tada@0.2.0`. In the Web GUI you can also use **Settings → Plugins → Add plugin** and enter `dsh-tada`.

### From a checkout

```sh
dsh plugin --profile desktop add /path/to/dsh-tada
```

The built Client bundle is committed, so a checkout needs no install or build step.

### Offline install

For a machine without npm access, pack once and copy the tarball over:

```sh
npm pack
dsh plugin --profile desktop add ./dsh-tada-0.2.0.tgz
```

## Configure

Open **Settings → Notifications**. Changes apply as soon as you click **Save** — no reload, no restart.

- **Notification content** — edit the title and body templates with a live preview.
- **In-app toast** — auto-dismiss after 1–30 s, or stay until you click **Open** or **Dismiss**.
- **Notification behavior** — master switch and per-event switches.
- **Advanced** — delivery channels, app name, notification language, quiet hours, minimum interval, and body length.

### Default events

| Event | Default |
|---|---|
| Turn complete, errors, approval needed, question asked | On |
| Subagent, workflow, or goal finished | Off |

### Templates

Titles and bodies can mix text with these presets:

| Preset | Value |
|---|---|
| `{{app}}` | App name (default `DSH`) |
| `{{event}}` | Localized event label, for example `Turn complete` |
| `{{session}}` | Session title |
| `{{workspace}}` | Workspace title |
| `{{detail}}` | Reply preview, error message, question, or tool reason |

The defaults are title `{{event}}` and body `{{session}}`. Unknown placeholders stay visible so typos are easy to spot.

### Quiet hours and throttling

- Quiet hours use `HH:MM-HH:MM` and may span midnight. They silence automatic turn-end alerts; approvals, questions, and subagent/workflow/goal alerts are always delivered.
- The minimum interval (default 1500 ms) limits how often turn-end alerts fire per Session.
- Notification copy follows the app language by default; it can be forced to English or Chinese.

## Troubleshooting

- **No system notifications?** The Desktop app normally grants the permission automatically. In a browser (`dsh web`), allow notifications when the page asks.
- **Alerts missing after an upgrade?** Reload the DSH page so the new Client half registers; restart DSH after a Host-side update.
- **Need diagnostics?** The loopback-only status endpoint reports the channel state and contains no secrets:

  ```sh
  curl -s "$DSH_WEB_URL/dsh-tada/status"
  ```

## Development

```sh
npm install
npm test        # rebuild the Client bundle, then run the test suite
npm run check   # build + preflight + tests
```

The Host half is plain ESM in `lib/`. The Client half is built from `src/client/` into the committed `client/client.js` — edit the source, not the bundle.

## License

MIT — see [LICENSE](LICENSE).
