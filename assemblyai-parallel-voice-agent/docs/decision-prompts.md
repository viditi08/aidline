# Give your voice agent a decision to make

Start with the answer your caller needs. “What does Python 3.13 support?” needs an explanation backed by sources. “Which support label should I put in my compatibility table?” needs a value with a consistent meaning. Both can use the same evidence.

## Tell the voice agent when to call

The starter already exposes both tools. To build a compatibility assistant, add this to `INSTRUCTIONS` in [agent.py](../src/agent.py), restart, and try the two turns below.

> Help me fill in a library compatibility table. For factual lookups, use Search when you need outside evidence. When I give you support labels and ask you to classify a feature, use Decisions. Carry the project, version, and feature forward from the conversation. If a missing detail would change the label, ask one short question.

1. “What does Python 3.13 offer for free threading?” Search can find the release documentation and explain the feature.
2. “Classify that support as stable, experimental, or explicitly unsupported.” Decisions can fill in the table entry. The caller supplied the options. The agent can resolve “that support” from the first turn.

A plain yes/no question can still be a Search lookup. The hosted Decisions tool accepts an explicit request for Decisions, a probability, a choice among supplied options, or a score on a supplied scale. Calling it directly is enough once the subject and criteria are known. [Parallel MCP tool reference](https://docs.parallel.ai/integrations/mcp/quickstart#web_decisions)

## Tell Decisions what counts

The voice prompt controls routing. The arguments sent to Decisions define the judgment. For the second turn, the agent can send:

```json
{
  "state": {"project": "CPython", "version": "3.13", "feature": "free-threaded builds"},
  "questions": {
    "support_status": {
      "type": "choice",
      "instructions": "Classify free-threaded builds for this release using the official Python documentation. If the evidence cannot distinguish these labels, decline to decide.",
      "criteria": {
        "stable": "The project documents stable, non-experimental support.",
        "experimental": "The project documents support and marks it experimental.",
        "explicitly_unsupported": "The project explicitly states this feature is unsupported in this release."
      }
    }
  }
}
```

Read back the label and the evidence behind it in one sentence. If the tool declines or the source is about a different release, tell the caller you couldn't verify the label. Missing documentation alone doesn't establish that a feature is unsupported.

For a probability, use `noul` and define one claim that could be true or false. For a score, define what each level means and order the levels from lowest to highest. A request like “Should we upgrade?” needs the caller's criterion first. Asking “Which package do you need the upgrade to support?” gives the agent something it can check. [Decisions question types](https://docs.parallel.ai/decisions/question-types)

## Build an agent around one recurring decision

Suppose your team maintains a compatibility table and uses the same three labels for every entry. Put the `support_status` question above in your application once. Let the conversation supply the project, version, and feature in `state`. That way, “experimental” means the same thing on every row.

Try this as a demo:

| Caller says | What your app should do |
| --- | --- |
| “Classify free-threaded builds for CPython.” | Ask “Which Python version?” The release can change the label. |
| “Three point thirteen.” | Evaluate the completed row once. Keep the returned label and citations together. If the evidence is insufficient, leave the row unresolved. |
| “Why did you pick that label?” | Explain it from the saved excerpt and name the source. |
| “Actually, check three point fourteen.” | Change the version and evaluate again with the same label definitions. |

For a prototype, the existing MCP tool and conversation history are enough to try this interaction. If other code will consume the table, give the app ownership of the rubric: expose a small tool such as `classify_support(project, version, feature)` and have it submit the fixed question to Decisions. Your application decides whether to record a label or flag the row for review. The [standalone API example](../src/parallel_api.py) shows how to send a Decisions request.

If one row needs several related judgments, send them as named questions about the same release. Citations belong to the whole request, so check which excerpt supports each answer before explaining it. [Decisions best practices](https://docs.parallel.ai/decisions/best-practices)
