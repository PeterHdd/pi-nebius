# pi-nebius

Use Nebius Token Factory models in Pi and compare them on coding tasks directly inside your session.

- Discover the models available to your Nebius account.
- Save per-model temperature, reasoning, and output-token settings.
- Benchmark models on your own prompt or a bundled coding task.
- Compare correctness, token usage, completion time, and time to first token.

Requires **Node.js 22.19+** and **Pi 0.85.1 or a compatible newer version**.

## Install

With Pi already installed, run in your terminal:

```bash
pi install npm:pi-nebius
export NEBIUS_API_KEY="your-api-key"
pi
```

Get your API key from [Nebius Token Factory](https://tokenfactory.nebius.com/).
Add the export to your shell profile if you want it available in future terminals.
Restart Pi after changing the key.

Inside Pi, run `/model`, search for `nebius`, and choose a model.

You can also install from GitHub:

```bash
pi install git:github.com/PeterHdd/pi-nebius
```

## Model settings

Open the settings menu inside Pi:

```text
/nebius-model
```

Choose a model to configure:

| Setting | What it controls |
| --- | --- |
| Temperature | Response variability, from 0 to 2, where supported. |
| Reasoning effort | The model's reasoning effort, where supported. |
| Maximum output tokens | The response-length limit. |
| Advanced: context window | The context limit Pi uses for the model. |
| Advanced: reasoning support | Whether Pi treats the model as reasoning-capable. |

You can open a specific model directly with `/nebius-model MODEL_ID`.

Settings are saved across restarts and apply to new requests. Choose **Inherit**, clear a numeric
value, or use **Reset all overrides** to restore defaults. A saved reasoning effort takes precedence
over Pi's `/thinking` setting.

Use values supported by the chosen model. Advanced settings change Pi's configuration, not the
model's actual capabilities. The default output limit is up to 4,096 tokens; increase it in the menu
if your model supports longer responses.

## Benchmark inside Pi

To benchmark your selected Nebius model on your own task:

```text
/nebius-benchmark
```

Enter your prompt in the editor. Run Pi from the project directory you want the models to work on.

To compare two models, once each:

```text
/nebius-benchmark --models moonshotai/Kimi-K2.6,deepseek-ai/DeepSeek-V4-Flash-0731 --runs 1
```

Use exact model IDs from your `/model` list. Increase `--runs` to repeat the task for each model.
Runs execute one at a time, each starting from a fresh copy of the same project.

For a bundled task with automatic correctness tests:

```text
/nebius-benchmark --task fix-auth-bug --models moonshotai/Kimi-K2.6,deepseek-ai/DeepSeek-V4-Flash-0731 --runs 1
```

Available tasks:

| Task | Work to complete |
| --- | --- |
| `fix-auth-bug` | Fix refresh-token expiry handling. |
| `add-api-endpoint` | Add an API endpoint. |
| `refactor-module` | Refactor an existing module. |
| `multi-file-feature` | Implement a feature across multiple files. |

Results appear directly in Pi:

| Metric | Meaning |
| --- | --- |
| Validated success | Runs that passed the task's correctness tests. |
| Input/output tokens | Average token usage per run, including all model requests. |
| Task duration | Median time to complete a run. |
| Observed TTFT | Median time from the first request to the first streamed text, reasoning, or tool content. |
| Throughput | Output tokens per second across the whole task, including tools and validation. |
| Agent turns / tool calls | Average number of turns and tool calls per run. |

**Mean** means average; **median** means the middle value after sorting (the average of the two
middle values for an even number of runs). With one run, both show that run's measurement.
Failed runs contribute to the performance metrics; missing measurements appear as `n/a`.
Custom prompts have no automatic correctness check, so a completed run does not establish success.

Detailed results, request settings, and resulting files are saved under `benchmark-results/`.
Benchmarks use your saved model settings at the start; later changes do not affect an active comparison.

Project copies include uncommitted changes and respect Git ignores. Dependencies, build output,
previous results, `.env`, and `.pem`/`.key` files are excluded. Include dependency setup in your prompt
if needed. Projects are limited to 10,000 files / 50 MiB; symlinks and special files are not supported.

Benchmarks use your Nebius account and incur inference charges. Model tools retain normal access to
your machine; project copies are not a security sandbox.

To stop a benchmark or view help:

```text
/nebius-benchmark cancel
/nebius-benchmark help
```

See [Benchmarking](docs/benchmarking.md) for custom validated tasks and scripted CLI usage.

## Refresh and update

Refresh the list of available Nebius models inside Pi:

```text
/nebius-refresh
```

Model lists are cached for up to 24 hours. Refreshing preserves your saved settings.

For an npm installation, update from your terminal:

```bash
pi update npm:pi-nebius
```

For a GitHub installation:

```bash
pi update git:github.com/PeterHdd/pi-nebius
```

Then run `/reload` inside Pi, or restart it.

## Troubleshooting

| Problem | What to do |
| --- | --- |
| Missing API key | Set `NEBIUS_API_KEY` in the terminal that launches Pi, then restart Pi. |
| Authentication error (401/403) | Check your Nebius key and project permissions. |
| Missing or unavailable model | Run `/nebius-refresh`, then choose a model with `/model`. |
| Rate limit (429) | Wait before retrying or reduce request frequency. |
| Server error (5xx) | Retry later. |
| Connection timeout | Check your connection and access to `api.tokenfactory.nebius.com`. |
| Output cut short | Open `/nebius-model` and adjust maximum output tokens within the model's supported limits. |
| Model does not use tools | Select a model that supports tool calling. |
| Benchmark validation failed | Read the failure details: the model's solution did not pass the task's tests. |

## More information

[Changelog](CHANGELOG.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

MIT licensed. See [LICENSE](LICENSE).
