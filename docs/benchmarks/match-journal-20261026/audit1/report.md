# Journal replay report

Games completed: 4/4; completed exchanged pairs: 2.

Counts (max_plies is NOT a draw):

```json
{
  "games": 4,
  "complete": 4,
  "legacyWins": 2,
  "experimentalWins": 1,
  "ruleDraws": 0,
  "maxPlies": 1,
  "incomplete": 0,
  "corrupt": 0,
  "incompleteReasons": {
    "no_end": 0,
    "partial_tail": 0,
    "time_limit": 0,
    "interrupted": 0,
    "capacity": 0,
    "search_failure": 0
  },
  "notRun": 0
}
```

Search API timings exclude journal writes/fsync; accepted games only:

```json
[
  {
    "mode": "legacy",
    "plies": 197,
    "apiMs": 197285.88270000007,
    "depthCounts": {
      "0": 33,
      "1": 133,
      "2": 28,
      "3": 3
    },
    "partialRoot": 33,
    "fallback": 0
  },
  {
    "mode": "experimental",
    "plies": 197,
    "apiMs": 197293.13630000013,
    "depthCounts": {
      "0": 40,
      "1": 125,
      "2": 29,
      "3": 3
    },
    "partialRoot": 40,
    "fallback": 0
  }
]
```

Per-game endings, persistence and wall time (before end-record write):

```json
[
  {
    "hash": "25fb004b362046c9f5af978825f4a66f1578b6ab7d17e633ac773f693556422b",
    "id": "journal-a96be37b-5da3-45c1-b4d8-386a7a5230c8/hirate/hirate-1",
    "status": "complete",
    "error": null,
    "partialTailBytes": 0,
    "plies": 115,
    "end": {
      "apiMs": 115153.37870000003,
      "detail": null,
      "endedAt": "2026-10-26T13:31:14.691Z",
      "finalHash": "538972bc56c37b9ee81dd815f5296f855dacaad037b6746f312e66037f5c9372",
      "gameResult": {
        "endReason": "checkmate",
        "loser": "gote",
        "winner": "sente"
      },
      "plies": 115,
      "reason": "rule",
      "saveMsBeforeEnd": 811.2540999999625,
      "type": "end",
      "uncommittedApiMs": 0,
      "wallMsBeforeEnd": 128883.8811,
      "finalSearchEncoded": [
        "null"
      ]
    },
    "finalHash": "538972bc56c37b9ee81dd815f5296f855dacaad037b6746f312e66037f5c9372"
  },
  {
    "hash": "c1ee4522e95c6fe95fa69be3969137656155b8835b1a59a526e43480196d2c6f",
    "id": "journal-a96be37b-5da3-45c1-b4d8-386a7a5230c8/hirate/hirate-2",
    "status": "complete",
    "error": null,
    "partialTailBytes": 0,
    "plies": 91,
    "end": {
      "apiMs": 91115.94790000004,
      "detail": null,
      "endedAt": "2026-10-26T13:32:54.932Z",
      "finalHash": "a3de1f98266496cd45e02e50c8b5539948f70a5669569cf5aa48470bcbcd6078",
      "gameResult": {
        "endReason": "checkmate",
        "loser": "gote",
        "winner": "sente"
      },
      "plies": 91,
      "reason": "rule",
      "saveMsBeforeEnd": 729.0141000000039,
      "type": "end",
      "uncommittedApiMs": 0,
      "wallMsBeforeEnd": 99837.1772,
      "finalSearchEncoded": [
        "null"
      ]
    },
    "finalHash": "a3de1f98266496cd45e02e50c8b5539948f70a5669569cf5aa48470bcbcd6078"
  },
  {
    "hash": "64df4641977cb4955013371283179ad1097c92669d0ff55dd831ed1b3e0cabb3",
    "id": "journal-a96be37b-5da3-45c1-b4d8-386a7a5230c8/replay/replay-1",
    "status": "complete",
    "error": null,
    "partialTailBytes": 0,
    "plies": 120,
    "end": {
      "apiMs": 120192.63230000001,
      "detail": null,
      "endedAt": "2026-10-26T13:35:11.600Z",
      "finalHash": "0268f4a8491137921cc9bd5851e0f27a069e366476a93b3465979ea436c99cf1",
      "gameResult": null,
      "plies": 120,
      "reason": "max_plies",
      "saveMsBeforeEnd": 911.4600999999955,
      "type": "end",
      "uncommittedApiMs": 0,
      "wallMsBeforeEnd": 136292.2012,
      "finalSearchEncoded": [
        "null"
      ]
    },
    "finalHash": "0268f4a8491137921cc9bd5851e0f27a069e366476a93b3465979ea436c99cf1"
  },
  {
    "hash": "9f6e932e75a023c925cafd64bf2c52b53d5fcbe3b562b13cf52feaed7000270b",
    "id": "journal-a96be37b-5da3-45c1-b4d8-386a7a5230c8/replay/replay-2",
    "status": "complete",
    "error": null,
    "partialTailBytes": 0,
    "plies": 68,
    "end": {
      "apiMs": 68117.06010000002,
      "detail": null,
      "endedAt": "2026-10-26T13:36:26.190Z",
      "finalHash": "03ac492ee9cf2eb5307674a50b30f8540b0dd3ff419f46e060761ba0f4ad0b18",
      "gameResult": {
        "endReason": "checkmate",
        "loser": "sente",
        "winner": "gote"
      },
      "plies": 68,
      "reason": "rule",
      "saveMsBeforeEnd": 491.61280000000966,
      "type": "end",
      "uncommittedApiMs": 0,
      "wallMsBeforeEnd": 74170.3309,
      "finalSearchEncoded": [
        "null"
      ]
    },
    "finalHash": "03ac492ee9cf2eb5307674a50b30f8540b0dd3ff419f46e060761ba0f4ad0b18"
  }
]
```

Two pairs are insufficient to establish general playing strength. No coefficient or default-mode change.
