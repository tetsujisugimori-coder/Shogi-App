Inclusive diagnostic milliseconds; n=1 measured call per position, warmup excluded. Overlapping stages must not be summed.

| Position | key A | full identity C | probe E inclusive | clone H | store G inclusive | FIFO I |
|---|---:|---:|---:|---:|---:|---:|
|mate-sente|255.266|190.874|91.056|14.427|64.878|26.922|
|resistance|11.714|10.568|7.537|0.828|1.749|0.525|
|evasion|22.826|18.474|13.613|2.196|3.081|1.124|
|capture|24.597|18.382|10.083|1.087|4.358|1.499|
|terminal-resistance-gote|10.703|12.672|5.135|0.535|1.875|0.599|
|recapture|86.588|64.567|24.065|2.099|26.912|11.202|
|mixed-distance|7.966|6.715|3.722|0.156|1.425|0.405|

Wrapper overhead control: independent C/P processes, neither uses CPU sampling, n=7; positive change means P is slower.

| Position | C p50 ms | P p50 ms | change | paired delta min / p50 / max ms |
|---|---:|---:|---:|---:|
|resistance|25.201|25.192|-0.03%|-0.463 / 0.502 / 32.090|
|evasion|62.790|64.007|1.94%|-0.702 / 1.750 / 4.751|
|capture|69.420|69.939|0.75%|-1.688 / 1.085 / 277.356|
|mixed-distance|154.600|153.778|-0.53%|-6.871 / 1.558 / 6.057|
