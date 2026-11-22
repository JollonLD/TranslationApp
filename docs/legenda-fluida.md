# Legenda fluida — framework e requisitos

Objetivo: a plateia lê a tradução ao vivo sem tropeços, **sem perder palavras, sentido nem contexto**.

## Framework (pipeline em 4 camadas)

```
Mesa → WhisperLiveKit ──► WlkStream ──► SourceTape ──► LiveEngine ──► StableText ──► celular
        (LocalAgreement)   (só o novo)   (frases e      (re-tradução    (exibição
                                          orações)       da linha        monótona)
                                                         aberta)
```

| Camada | Arquivo | Garantia |
|---|---|---|
| 1. Escuta | WhisperLiveKit (simulstreaming) | Palavras confirmadas por LocalAgreement não mudam. |
| 2. Fita de origem | `wlkTranscript.ts` (`WlkStream`), `sourceTape.ts` (`pushCommitted`) | Cada palavra ouvida entra **uma vez**, na ordem. A legenda fecha no fim da frase, numa vírgula de frase longa (≥ 28 palavras), em pausa de 2,2 s ou com 46 palavras. |
| 3. Tradução | `liveEngine.ts` | Re-tradução da linha aberta (uma requisição por idioma, as antigas canceladas). Ao fechar, a frase é traduzida inteira. |
| 4. Exibição | `stableCaption.ts` (`StableText`), `TranscriptFeed.tsx` | Na linha ao vivo só aparece o prefixo em que duas traduções seguidas concordam. Palavra já mostrada não some (no máximo 2 palavras do fim podem ser corrigidas). Durante uma pausa, a tradução aparece inteira. A legenda final substitui a linha uma única vez. |

Referências: Arivazhagan et al. 2020, *Re-translation versus streaming* (arXiv:2004.03643), sobre re-tradução e o limite de erasure < 0,2. Liu et al. 2020 e Macháček et al. 2023 (arXiv:2307.14743), sobre LocalAgreement. Guias BBC/Ofcom: 160–180 palavras/min e legenda ao vivo em rolagem sem refluxo do texto já lido.

## Requisitos funcionais

| ID | Requisito | Status |
|---|---|---|
| RF1 | Toda palavra confirmada pelo ASR aparece exatamente uma vez nas legendas finais, na ordem. | ✅ testado |
| RF2 | A linha ao vivo mostra só o idioma do ouvinte; enquanto não há tradução estável, mostra "…" e nunca o português. | ✅ implementado (cliente) |
| RF3 | Texto já exibido na linha ao vivo não é reescrito (no máximo 2 palavras do fim). | ✅ testado |
| RF4 | Frase longa é dividida numa pausa de oração (vírgula, ponto e vírgula, dois-pontos). O bloco termina em "…" e o seguinte continua com minúscula. | ✅ testado |
| RF5 | O polimento por LLM (`shapeFinal`) só pode mudar pontuação e maiúsculas. Se a saída perder, acrescentar ou trocar palavras, é descartada. | ✅ testado |
| RF6 | O ouvinte que troca de idioma recebe a linha aberta e as anteriores no novo idioma. | ✅ testado (já existia) |
| RF7 | Rolagem automática pausa quando o ouvinte sobe a tela; botão "voltar ao vivo". | ✅ já existia |
| RF8 | Glossário da igreja aplicado de forma consistente (`polishChurchTerms`). | ✅ já existia |
| RF9 | Contexto das 2–3 frases anteriores na tradução final. | ⏳ pendente: o Riva traduz a frase isolada; colocar contexto no prompt pode fazer o modelo traduzir o contexto também. Precisa de teste com o modelo real. |

## Requisitos não funcionais (com critério de aceite)

| ID | Requisito | Meta | Como medir | Status |
|---|---|---|---|---|
| RNF1 | Estabilidade da linha ao vivo | erasure normalizada < 0,2 | `testStableTextMonotonic`, `testLiveEngineNoisyMtStaysReadable` | ✅ 0,00 (simulado) e 0,15 (MT instável simulada) |
| RNF2 | Zero alteração retroativa em legenda final já exibida (exceto pontuação) | 0 | RF5 + testes | ✅ |
| RNF3 | Zero perda ou duplicação de palavras numa sessão longa | 0 em mais de 300 palavras | `testWlkLongSermonPastTapeWindow` | ✅ |
| RNF4 | Latência fala→tela | p50 ≤ 3 s, p95 ≤ 5 s | log `[ouviu]` × `[tradução … ao vivo]` no culto | ⏳ medir no culto |
| RNF5 | Latência da chamada de MT | p95 ≤ 1 s | log do servidor | ⏳ medir no culto |
| RNF6 | Tamanho do bloco | ≤ 30 palavras por legenda com vírgula disponível; ≤ 46 sempre | `testClauseSplitKeepsWords` | ✅ |
| RNF7 | Acessibilidade | contraste ≥ 4,5:1; sem animação com `prefers-reduced-motion` | revisão visual | ✅ animação nova respeita o reduced-motion; contraste não medido |

## Trade-off conhecido

A linha ao vivo fica **cerca de uma tradução atrás** da fala, o custo do LocalAgreement (a literatura cita +0,7 s). Em troca, o que a pessoa já leu não pula. Numa pausa de 450 ms ou mais, a tradução aparece inteira. Quando o tradutor muda a ordem das palavras no começo da linha, a linha ao vivo espera pela legenda final em vez de reescrever.

## Como rodar as verificações

```bash
npm run test:e2e   # Node ≥ 20
```
