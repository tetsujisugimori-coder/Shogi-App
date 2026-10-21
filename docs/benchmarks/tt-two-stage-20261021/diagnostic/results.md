# 工程別診断（通常性能の比較に使用しない）

各局面/variantにwarmup1回、本測定1回。A=OFF、B=旧ON、C=新ON。clock/wrapper費用を含み、主測定とは別process/JIT状態。probeMsはMap・統計・callback時間を含む。hitIdentityMsはCのhitのみで、B全生成・Cのmiss保存用生成を含まない。storeMsはJSON/容量/Mapを含み、cloneを含まない。

| 局面 | variant | call ms | key ms | probe ms | hitIdentity ms | store ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| mixed-distance | B | 27.059 | 1.138 | 0.249 | 0.000 | 0.166 |
| mixed-distance | C | 24.150 | 1.059 | 0.445 | 0.212 | 0.110 |
| mixed-distance | A | 24.335 | 0.000 | 0.000 | 0.000 | 0.000 |
| hirate-exchange | A | 19130.677 | 0.000 | 0.000 | 0.000 | 0.000 |
| hirate-exchange | B | 19492.261 | 463.567 | 79.432 | 0.000 | 51.477 |
| hirate-exchange | C | 19808.132 | 471.507 | 190.901 | 111.460 | 42.480 |
| long-legal-history | C | 144.966 | 6.840 | 6.242 | 4.820 | 0.848 |
| long-legal-history | A | 79.432 | 0.000 | 0.000 | 0.000 | 0.000 |
| long-legal-history | B | 205.743 | 6.619 | 1.172 | 0.000 | 0.685 |
