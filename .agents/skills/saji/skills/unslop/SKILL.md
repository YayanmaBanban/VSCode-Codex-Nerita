---
name: unslop
description: 文章からAI特有の不自然な表現を取り除く。
disable-model-invocation: true
---

# Unslop

文章を編集してAI特有の表現パターンを除去する。以下のパターンを確認してから書き直す。意味を維持し、目的に合った文体にする。

規則番号はほかのSkillから参照される固定IDである。削除された規則の番号は欠番のままにする。

3. 新しい事実を加えない語尾の「-ing」句（「highlighting...」「ensuring...」など）を付けない。
5. 「専門家は考えている」のように出典を曖昧にしない。出典を明示するか削除する。
7. AI特有の語を使わない：additionally、crucial、delve、enhance、foster、landscape、pivotal、showcase、testament、underscore、vibrant。
8. 「serves as」「stands as」「boasts」「features」の代わりに「is」または「has」を使う。
9. 「not just X, but Y」の構文にしない。伝えたいことを直接書く。
10. 考えを無理に3つに揃えない。
11. 一つの対象には一つの名前を使い、その名前を繰り返す。
12. XとYが実際の尺度上の両端でない限り「from X to Y」を使わない。
13. em dash、en dash、ダッシュとして使うハイフンを使わず、その代用として括弧を使うこともしない。ピリオドかコンマを使う。
14. コロンは箇条書きや具体例の前にだけ置き、文の途中の接続には使わない。
15. 固有名詞や頭字語を何でも太字にしない。
16. 同じ内容を繰り返す太字ラベルとコロン（「**Performance:** Performance improved...」など）を使わない。新しい情報を加え、ピリオドで終わる太字の書き出しは許容する。
17. 見出しはsentence caseにする。
18. 装飾的な絵文字を使わない。
19. 引用符は曲がった引用符ではなく直線のものを使う。
20. 「I hope this helps!」「Let me know if...」のようなチャットボット特有の定型句を使わない。
22. 褒め言葉や同意から書き始めない。直接回答する。
23. 不要な語句を削る。「In order to」を「to」にし、「it is important to note that」を削除する。
24. 留保表現は最大1つ。「may」を用いる。
25. 汎用的な結論を書かない。具体的な計画または事実を述べる。
26. 抽象的な比喩名詞を使わない：substrate、wedge、vector、nexus、primitive、harness、surface、scaffolding、paradigm、ratchet、north star、flywheel。具体的な名称にする。
27. 感じ方ではなく、何をするものかを書く。仕組みまたは数値を示す。別のプロジェクトの文書にもそのまま載せられる文章なら削除する。
28. 1文につき考えは1つ。読み直さないと理解できない文は分ける。
29. 能動態を使う。行為者が不明または重要でない場合を除き、行為者を明示する。
30. 副詞を削るか、より強い動詞を使う。数値を示す。
31. 平易な語を使う。「utilize」「leverage」ではなく「use」を使う。
32. 文字どおりの表現があるなら、比喩、格言、人格化したコード、比喩的な動詞を使わない。
33. 冠詞と動詞を含む完全な文を書く。矢印や略語は言葉で説明する。
