# Captação de voz — guia da cabine

Objetivo: o reconhecimento de fala (WhisperLiveKit) ouvir **todas** as palavras e entendê-las certo, antes de qualquer tradução.

## 1. Sinal da mesa (o que mais ajuda)

- Ligue no PC uma **saída AUX dedicada só ao microfone do pregador**, pré-efeitos (sem reverb), e não o mix geral. Música, reverb e retorno fazem o Whisper errar e inventar frases.
- Use uma **interface USB** em vez da entrada de microfone do PC.
- **Nível:** picos entre **−18 e −6 dBFS**. A cabine mostra um medidor:
  - **ok**: dentro da faixa;
  - **sinal baixo**: fala abaixo de −40 dBFS por 3 s. Aumente o AUX;
  - **clipando**: pico ≥ −1 dBFS. Diminua o AUX ou o ganho.

## 2. Configuração (`ChiesaIlFaro.bat`)

| Variável | Padrão | Para quê |
|---|---|---|
| `WLK_MODEL` | `small` | Modelo do Whisper. `medium` ou `large-v3-turbo` acertam mais e pesam mais na CPU. Só troque depois de medir (seção 4). |
| `WLK_INIT_PROMPT` | vocabulário da igreja em pt | Passado como `--static-init-prompt`. Ajuda o modelo com nomes bíblicos e termos como Espírito Santo e santificação. Vazio desliga. |
| `WLK_PAUSE_SECONDS` | `1.2` | Pausa que separa segmentos. Se respirações longas cortam frases, teste 1.5–1.8. |

A versão do WhisperLiveKit está fixada em **0.2.26** no `scripts/build-windows.mjs`. A flag `--static-init-prompt` foi conferida no código do pacote dessa versão.

## 3. O que o servidor corrige sozinho

- **Alucinações** (`server/src/asrFilter.ts`):
  - descarta frases típicas de silêncio ou música ("Obrigado por assistir", "Legendas pela comunidade Amara.org", "[Música]");
  - laços longos (a mesma palavra 8 vezes ou mais, uma frase 6 vezes ou mais) ficam com 3 ocorrências;
  - repetição litúrgica ("santo, santo, santo, santo", "aleluia…") **não** é alterada.
- **Termos da igreja** (`correctAsrTerms` em `server/src/churchGlossary.ts`):
  - acentos de livros bíblicos (Efésios, Isaías, Gênesis…);
  - palavras partidas ("a leluia" → "aleluia");
  - números falados depois de *capítulo/versículo/salmo* viram dígitos ("capítulo três versículo dezesseis" → "capítulo 3 versículo 16");
  - "amem" (verbo) e "Judas trinta moedas" ficam como foram ditos.

## 4. Medir antes de mudar (WER)

1. Grave 10–15 min do áudio da mesa e converta:
   ```bash
   ffmpeg -i culto.mp3 -ar 16000 -ac 1 -c:a pcm_s16le culto.wav
   ```
2. Transcreva à mão uma vez (`ref.txt`).
3. Com o WhisperLiveKit rodando na configuração a testar:
   ```bash
   npm run wer -w server -- --audio culto.wav --ref ref.txt --realtime --out small.json
   ```
4. Troque `WLK_MODEL`, `WLK_INIT_PROMPT` ou `WLK_PAUSE_SECONDS`, reinicie e repita. Fique com a configuração de menor WER que ainda acompanha a fala em tempo real.

O relatório mostra WER, substituições, deleções e inserções, e **as palavras perdidas**, que são o que mais importa aqui.

## 5. Tradução (latência)

- O polimento por LLM das legendas tem fila própria, de alta prioridade: não espera resumo nem memória do sermão. Se ficar mais de 4 s na fila, é descartado.
- O Riva roda com `temperature 0` (traduções repetíveis, que o estabilizador da linha ao vivo confirma mais cedo) e com `max_tokens` proporcional à frase.

## Testes

```bash
npm test    # unitários + e2e (Node ≥ 20)
```
