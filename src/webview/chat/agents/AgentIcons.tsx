// 同梱 SVG を表示キーへ対応付け、Vite と Extension の両ビルドで読み込む。
import type { AgentIconKey } from "../../../shared/subAgents";
import alien from "../../../../media/icons/agents/alien_32.svg?raw";
import anubis from "../../../../media/icons/agents/anubis_32.svg?raw";
import cabbage from "../../../../media/icons/agents/cabbage_32.svg?raw";
import cheetah from "../../../../media/icons/agents/cheetah_32.svg?raw";
import chochin_obake from "../../../../media/icons/agents/chochin_obake_32.svg?raw";
import daikon from "../../../../media/icons/agents/daikon_32.svg?raw";
import duck from "../../../../media/icons/agents/duck_32.svg?raw";
import ghost from "../../../../media/icons/agents/ghost_32.svg?raw";
import golden_retriever from "../../../../media/icons/agents/golden_retriever_32.svg?raw";
import kitsune from "../../../../media/icons/agents/kitsune_32.svg?raw";
import mendako from "../../../../media/icons/agents/mendako_32.svg?raw";
import penguin from "../../../../media/icons/agents/penguin_32.svg?raw";
import seal from "../../../../media/icons/agents/seal_32.svg?raw";
import turtle from "../../../../media/icons/agents/turtle_32.svg?raw";

export const icons: Record<AgentIconKey, string> = {
	alien,
	anubis,
	cabbage,
	cheetah,
	chochin_obake,
	daikon,
	duck,
	ghost,
	golden_retriever,
	kitsune,
	mendako,
	penguin,
	seal,
	turtle,
};
