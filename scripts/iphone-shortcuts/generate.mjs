#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const GATEWAY =
  'https://hsaedwwqpcjizeozjbch.supabase.co/functions/v1/phone-gateway';
const SECRET_PLACEHOLDER = '__PHONE_GATEWAY_SECRET__';
const DEFAULT_OUT_DIR = '/private/tmp/lascis-board-shortcuts';
const OBJECT_REPLACEMENT = '\uFFFC';

const args = parseArgs(process.argv.slice(2));
const outDir = resolve(args.outDir ?? DEFAULT_OUT_DIR);
const secret = args.secret ?? process.env.PHONE_GATEWAY_SECRET ?? SECRET_PLACEHOLDER;

if (secret === SECRET_PLACEHOLDER && !args.allowPlaceholder) {
  fail(
    `Refusing to generate with ${SECRET_PLACEHOLDER}. Set PHONE_GATEWAY_SECRET or pass --secret.`
  );
}

checkCommand('openssl');
if (args.sign) checkCommand('shortcuts');
if (args.open) {
  if (!args.sign) fail('--open requires --sign so the imported files are signed .shortcut files.');
  checkCommand('open');
}

mkdirSync(outDir, { recursive: true });

const shortcuts = [
  buildLogCreatine(secret),
  buildLogWater(secret),
  buildAsk(secret),
  buildBrief(secret),
  buildNutritionToday(secret),
  buildSleepSummary(secret),
  buildLogFoodFromDictation(
    'Atıştırmalık Logla',
    'atistirmalik-logla',
    'snack',
    59436,
    4282601983,
    secret
  ),
  buildLogFoodFromDictation(
    'Akşam Yemeği Logla',
    'aksam-yemegi-logla',
    'dinner',
    59549,
    463140863,
    secret
  ),
];

for (const shortcut of shortcuts) {
  const plistPath = join(outDir, `${shortcut.fileName}.unsigned.shortcut`);
  const signedPath = join(outDir, `${shortcut.fileName}.shortcut`);
  writeFileSync(plistPath, plist(shortcut.workflow), 'utf8');
  console.log(`wrote ${plistPath}`);

  if (args.sign) {
    execFileSync('shortcuts', [
      'sign',
      '--mode',
      'anyone',
      '--input',
      plistPath,
      '--output',
      signedPath,
    ]);
    console.log(`signed ${signedPath}`);
  }

  if (args.open) {
    execFileSync('open', [signedPath]);
    console.log(`opened ${signedPath}`);
  }
}

function buildLogCreatine(phoneSecret) {
  const requestId = uuid();
  const loggedId = uuid();
  const htmlId = uuid();
  const richTextId = uuid();
  const okId = uuid();

  return shortcut('Log Creatine', 'log-creatine', 61444, 4282601983, [
    postAction(requestId, phoneSecret, [
      textItem('action', 'log_supplement'),
      textItem('title', 'Kreatin 5 g'),
      numberItem('calories', 0),
    ]),
    getValueAction(loggedId, 'logged', actionOutput(requestId, 'Contents of URL')),
    htmlTextAction(
      htmlId,
      htmlCard({
        emoji: '✅',
        title: 'Kreatin Loglandı',
        subtitle: 'Lasci’s Board · supplement',
        accent: '#5e8c7b',
        bodyParts: ['Kaydedilen: ', actionOutput(loggedId, 'Dictionary Value')],
        chips: ['Bugün', '0 kcal', 'Supplement'],
      })
    ),
    richTextFromHtmlAction(richTextId, actionOutput(htmlId, 'Text')),
    quickLookAction(actionOutput(richTextId, 'Rich Text from HTML')),
    getValueAction(okId, 'ok', actionOutput(requestId, 'Contents of URL')),
  ]);
}

function buildLogWater(phoneSecret) {
  const requestId = uuid();
  const loggedId = uuid();
  const htmlId = uuid();
  const richTextId = uuid();
  const okId = uuid();

  return shortcut('Su İç', 'su-ic', 59545, 431817727, [
    postAction(requestId, phoneSecret, [
      textItem('action', 'log_water'),
      numberItem('amount_ml', 1000),
    ]),
    getValueAction(loggedId, 'logged_ml', actionOutput(requestId, 'Contents of URL')),
    htmlTextAction(
      htmlId,
      htmlCard({
        emoji: '💧',
        title: 'Su Eklendi',
        subtitle: 'Lasci’s Board · hidrasyon',
        accent: '#4f8fc8',
        bodyParts: [actionOutput(loggedId, 'Dictionary Value'), ' ml su kaydedildi.'],
        chips: ['Bugün', '1 L', 'Su'],
      })
    ),
    richTextFromHtmlAction(richTextId, actionOutput(htmlId, 'Text')),
    quickLookAction(actionOutput(richTextId, 'Rich Text from HTML')),
    getValueAction(okId, 'ok', actionOutput(requestId, 'Contents of URL')),
  ]);
}

function buildAsk(phoneSecret) {
  const dictatedId = uuid();
  const requestId = uuid();
  const textId = uuid();
  const htmlId = uuid();
  const richTextId = uuid();
  const okId = uuid();

  return shortcut("AI'a Sor", 'aia-sor', 59716, 4271458815, [
    {
      WFWorkflowActionIdentifier: 'is.workflow.actions.dictatetext',
      WFWorkflowActionParameters: {
        UUID: dictatedId,
        WFDictateTextLanguage: 'tr-TR',
        WFDictateTextStopListening: 'After Pause',
      },
    },
    postAction(requestId, phoneSecret, [
      textItem('action', 'ask'),
      tokenItem('q', actionOutput(dictatedId, 'Dictated Text')),
    ]),
    getValueAction(textId, 'text', actionOutput(requestId, 'Contents of URL')),
    {
      WFWorkflowActionIdentifier: 'is.workflow.actions.speaktext',
      WFWorkflowActionParameters: {
        UUID: uuid(),
        WFInput: tokenAttachment(actionOutput(textId, 'Dictionary Value')),
        WFSpeakTextLanguage: 'tr-TR',
        WFSpeakTextPitch: 1,
        WFSpeakTextRate: 0.5,
        WFSpeakTextWait: true,
      },
    },
    htmlTextAction(
      htmlId,
      htmlCard({
        emoji: '🤖',
        title: "AI'a Sor",
        subtitle: 'Türkçe yanıt',
        accent: '#6f6ab8',
        bodyParts: [actionOutput(textId, 'Dictionary Value')],
        chips: ['Sesli yanıt', 'Lasci’s Board'],
      })
    ),
    richTextFromHtmlAction(richTextId, actionOutput(htmlId, 'Text')),
    quickLookAction(actionOutput(richTextId, 'Rich Text from HTML')),
    getValueAction(okId, 'ok', actionOutput(requestId, 'Contents of URL')),
  ]);
}

function buildBrief(phoneSecret) {
  const requestId = uuid();
  const textId = uuid();
  const htmlId = uuid();
  const richTextId = uuid();
  const okId = uuid();

  return shortcut('Sabah Brief', 'sabah-brief', 59781, 431817727, [
    postAction(requestId, phoneSecret, [textItem('action', 'brief')]),
    getValueAction(textId, 'text', actionOutput(requestId, 'Contents of URL')),
    htmlTextAction(
      htmlId,
      htmlCard({
        emoji: '🌤️',
        title: 'Sabah Brief',
        subtitle: 'Bugünün kısa planı',
        accent: '#d8a24a',
        bodyParts: [actionOutput(textId, 'Dictionary Value')],
        chips: ['Görevler', 'Program', 'Antrenman'],
      })
    ),
    richTextFromHtmlAction(richTextId, actionOutput(htmlId, 'Text')),
    quickLookAction(actionOutput(richTextId, 'Rich Text from HTML')),
    getValueAction(okId, 'ok', actionOutput(requestId, 'Contents of URL')),
  ]);
}

function buildNutritionToday(phoneSecret) {
  const requestId = uuid();
  const kcalId = uuid();
  const proteinId = uuid();
  const waterId = uuid();
  const entriesId = uuid();
  const htmlId = uuid();
  const richTextId = uuid();
  const okId = uuid();

  return shortcut('Beslenme Durumu', 'beslenme-durumu', 59752, 4282601983, [
    postAction(requestId, phoneSecret, [textItem('action', 'nutrition_today')]),
    getValueAction(kcalId, 'kcal', actionOutput(requestId, 'Contents of URL')),
    getValueAction(proteinId, 'protein_g', actionOutput(requestId, 'Contents of URL')),
    getValueAction(waterId, 'water_ml', actionOutput(requestId, 'Contents of URL')),
    getValueAction(entriesId, 'entries', actionOutput(requestId, 'Contents of URL')),
    htmlTextAction(
      htmlId,
      nutritionHtmlCard(
        actionOutput(kcalId, 'Dictionary Value'),
        actionOutput(proteinId, 'Dictionary Value'),
        actionOutput(waterId, 'Dictionary Value'),
        actionOutput(entriesId, 'Dictionary Value')
      )
    ),
    richTextFromHtmlAction(richTextId, actionOutput(htmlId, 'Text')),
    quickLookAction(actionOutput(richTextId, 'Rich Text from HTML')),
    getValueAction(okId, 'ok', actionOutput(requestId, 'Contents of URL')),
  ]);
}

function buildSleepSummary(phoneSecret) {
  const requestId = uuid();
  const textId = uuid();
  const htmlId = uuid();
  const richTextId = uuid();
  const okId = uuid();
  const prompt =
    'Uyku verilerime bak ve bana kısa bir Türkçe uyku özeti ver. Sadece uyku süresi, kalite yorumu, son 7 günle karşılaştırma ve bugün için tek öneriyi yaz. Kısa, net, madde madde olsun.';

  return shortcut('Uyku Özeti', 'uyku-ozeti', 59717, 431817727, [
    postAction(requestId, phoneSecret, [textItem('action', 'ask'), textItem('q', prompt)]),
    getValueAction(textId, 'text', actionOutput(requestId, 'Contents of URL')),
    {
      WFWorkflowActionIdentifier: 'is.workflow.actions.speaktext',
      WFWorkflowActionParameters: {
        UUID: uuid(),
        WFInput: tokenAttachment(actionOutput(textId, 'Dictionary Value')),
        WFSpeakTextLanguage: 'tr-TR',
        WFSpeakTextPitch: 1,
        WFSpeakTextRate: 0.5,
        WFSpeakTextWait: true,
      },
    },
    htmlTextAction(
      htmlId,
      htmlCard({
        emoji: '🌙',
        title: 'Uyku Özeti',
        subtitle: 'Dinlenme · toparlanma · odak',
        accent: '#5e8c7b',
        bodyParts: [actionOutput(textId, 'Dictionary Value')],
        chips: ['Uyku', '7 gün', 'Öneri'],
      })
    ),
    richTextFromHtmlAction(richTextId, actionOutput(htmlId, 'Text')),
    quickLookAction(actionOutput(richTextId, 'Rich Text from HTML')),
    getValueAction(okId, 'ok', actionOutput(requestId, 'Contents of URL')),
  ]);
}

function buildLogFoodFromDictation(name, slug, mealSlot, glyph, color, phoneSecret) {
  const dictatedId = uuid();
  const requestId = uuid();
  const loggedId = uuid();
  const htmlId = uuid();
  const richTextId = uuid();
  const okId = uuid();

  return shortcut(name, slug, glyph, color, [
    {
      WFWorkflowActionIdentifier: 'is.workflow.actions.dictatetext',
      WFWorkflowActionParameters: {
        UUID: dictatedId,
        WFDictateTextLanguage: 'tr-TR',
        WFDictateTextStopListening: 'After Pause',
      },
    },
    postAction(requestId, phoneSecret, [
      textItem('action', 'log_food'),
      textItem('meal_slot', mealSlot),
      tokenItem('title', actionOutput(dictatedId, 'Dictated Text')),
    ]),
    getValueAction(loggedId, 'logged', actionOutput(requestId, 'Contents of URL')),
    htmlTextAction(
      htmlId,
      htmlCard({
        emoji: '🍽️',
        title: `${name}`,
        subtitle: mealSlot === 'dinner' ? 'Akşam yemeği kaydı' : 'Atıştırmalık kaydı',
        accent: mealSlot === 'dinner' ? '#c86b4a' : '#d8a24a',
        bodyParts: ['Kaydedilen: ', actionOutput(loggedId, 'Dictionary Value')],
        chips: [mealSlot === 'dinner' ? 'Akşam' : 'Atıştırmalık', 'Bugün', 'Yeni kayıt'],
      })
    ),
    richTextFromHtmlAction(richTextId, actionOutput(htmlId, 'Text')),
    quickLookAction(actionOutput(richTextId, 'Rich Text from HTML')),
    getValueAction(okId, 'ok', actionOutput(requestId, 'Contents of URL')),
  ]);
}

function shortcut(name, slug, glyph, color, actions) {
  return {
    name,
    slug,
    fileName: safeFileName(name),
    workflow: {
      WFWorkflowActions: actions,
      WFWorkflowClientRelease: '26.0',
      WFWorkflowClientVersion: '2600',
      WFWorkflowHasOutputFallback: false,
      WFWorkflowHasShortcutInputVariables: false,
      WFWorkflowIcon: {
        WFWorkflowIconGlyphNumber: glyph,
        WFWorkflowIconImageData: Buffer.alloc(0),
        WFWorkflowIconStartColor: color,
      },
      WFWorkflowImportQuestions: [],
      WFWorkflowInputContentItemClasses: ['WFStringContentItem'],
      WFWorkflowMinimumClientVersion: 411,
      WFWorkflowMinimumClientVersionString: '411',
      WFWorkflowName: name,
      WFWorkflowOutputContentItemClasses: ['WFStringContentItem'],
      WFWorkflowTypes: ['MenuBar', 'WatchKit'],
    },
  };
}

function postAction(id, phoneSecret, jsonItems) {
  return {
    WFWorkflowActionIdentifier: 'is.workflow.actions.downloadurl',
    WFWorkflowActionParameters: {
      UUID: id,
      Advanced: true,
      ShowHeaders: true,
      WFURL: GATEWAY,
      WFHTTPMethod: 'POST',
      WFHTTPBodyType: 'JSON',
      WFHTTPHeaders: dictionary([
        textItem('x-phone-secret', phoneSecret),
        textItem('Content-Type', 'application/json'),
      ]),
      WFJSONValues: dictionary(jsonItems),
    },
  };
}

function htmlTextAction(id, text) {
  return {
    WFWorkflowActionIdentifier: 'is.workflow.actions.gettext',
    WFWorkflowActionParameters: {
      UUID: id,
      WFTextActionText: text,
    },
  };
}

function richTextFromHtmlAction(id, input) {
  return {
    WFWorkflowActionIdentifier: 'is.workflow.actions.getrichtextfromhtml',
    WFWorkflowActionParameters: {
      UUID: id,
      WFHTML: tokenAttachment(input),
    },
  };
}

function quickLookAction(input) {
  return {
    WFWorkflowActionIdentifier: 'is.workflow.actions.previewdocument',
    WFWorkflowActionParameters: {
      UUID: uuid(),
      WFInput: tokenAttachment(input),
      WFQuickLookActionFullScreen: true,
    },
  };
}

function getValueAction(id, key, input) {
  return {
    WFWorkflowActionIdentifier: 'is.workflow.actions.getvalueforkey',
    WFWorkflowActionParameters: {
      UUID: id,
      WFDictionaryKey: key,
      WFInput: tokenAttachment(input),
    },
  };
}

function htmlCard({ emoji, title, subtitle, accent, bodyParts, chips }) {
  const chipHtml = chips.map((chip) => `<span class="chip">${escapeHtml(chip)}</span>`).join('');
  return tokenStringFromParts([
    `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body {
    margin: 0;
    padding: 20px;
    background: #f6f0e7;
    color: #241f1a;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;
  }
  .kart {
    border: 1px solid #decfbd;
    border-radius: 18px;
    padding: 18px;
    background: #fffaf2;
    box-shadow: 0 10px 28px rgba(53, 43, 31, 0.12);
  }
  .baslik {
    font-size: 26px;
    font-weight: 800;
    margin: 0 0 6px;
  }
  .alt {
    color: #766b5f;
    font-size: 13px;
    margin-bottom: 16px;
  }
  .chipler {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 12px 0 16px;
  }
  .chip {
    border-radius: 999px;
    padding: 6px 10px;
    background: #f0e5d4;
    color: #4d4338;
    font-size: 12px;
    font-weight: 700;
  }
  .ozet {
    white-space: pre-wrap;
    font-size: 17px;
    line-height: 1.45;
  }
  .cizgi {
    height: 10px;
    border-radius: 999px;
    background: linear-gradient(90deg, ${accent}, #d8a24a, #c86b4a);
    margin: 14px 0 4px;
  }
  .etiket {
    font-size: 12px;
    color: #766b5f;
  }
</style>
</head>
<body>
  <main class="kart">
    <h1 class="baslik">${escapeHtml(emoji)} ${escapeHtml(title)}</h1>
    <div class="alt">${escapeHtml(subtitle)}</div>
    <div class="cizgi"></div>
    <div class="chipler">${chipHtml}</div>
    <div class="etiket">Lasci’s Board</div>
    <section class="ozet">`,
    ...bodyParts,
    `</section>
  </main>
</body>
</html>`,
  ]);
}

function nutritionHtmlCard(kcalOutput, proteinOutput, waterOutput, entriesOutput) {
  return tokenStringFromParts([
    `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body {
    margin: 0;
    padding: 20px;
    background: #f6f0e7;
    color: #241f1a;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;
  }
  .kart {
    border: 1px solid #decfbd;
    border-radius: 18px;
    padding: 18px;
    background: #fffaf2;
    box-shadow: 0 10px 28px rgba(53, 43, 31, 0.12);
  }
  h1 {
    font-size: 26px;
    margin: 0 0 6px;
  }
  .alt {
    color: #766b5f;
    font-size: 13px;
    margin-bottom: 16px;
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 10px;
  }
  .metrik {
    border: 1px solid #eadccb;
    border-radius: 14px;
    padding: 14px;
    background: #fcf5ea;
  }
  .deger {
    font-size: 34px;
    line-height: 1;
    font-weight: 850;
  }
  .etiket {
    margin-top: 5px;
    color: #766b5f;
    font-size: 13px;
    font-weight: 700;
  }
  .bar {
    height: 10px;
    border-radius: 999px;
    background: linear-gradient(90deg, #5e8c7b, #d8a24a, #c86b4a);
    margin-top: 14px;
  }
</style>
</head>
<body>
  <main class="kart">
    <h1>🍽️ Beslenme Durumu</h1>
    <div class="alt">Bugünkü kayıtların kısa özeti</div>
    <div class="grid">
      <section class="metrik"><div class="deger">`,
    kcalOutput,
    `</div><div class="etiket">kcal</div><div class="bar"></div></section>
      <section class="metrik"><div class="deger">`,
    proteinOutput,
    ` g</div><div class="etiket">protein</div><div class="bar"></div></section>
      <section class="metrik"><div class="deger">`,
    waterOutput,
    ` ml</div><div class="etiket">su</div><div class="bar"></div></section>
      <section class="metrik"><div class="deger">`,
    entriesOutput,
    `</div><div class="etiket">kayıt</div><div class="bar"></div></section>
    </div>
  </main>
</body>
</html>`,
  ]);
}

function dictionary(items) {
  return {
    WFSerializationType: 'WFDictionaryFieldValue',
    Value: {
      WFDictionaryFieldValueItems: items,
    },
  };
}

function textItem(key, value) {
  return {
    WFItemType: 0,
    WFKey: key,
    WFValue: value,
  };
}

function numberItem(key, value) {
  return {
    WFItemType: 3,
    WFKey: key,
    WFValue: {
      WFSerializationType: 'WFNumberSubstitutableState',
      Value: {
        string: String(value),
      },
    },
  };
}

function tokenItem(key, output) {
  return {
    WFItemType: 0,
    WFKey: key,
    WFValue: tokenString(OBJECT_REPLACEMENT, { 0: output }),
  };
}

function actionOutput(outputId, outputName) {
  return {
    OutputUUID: outputId,
    Type: 'ActionOutput',
    OutputName: outputName,
  };
}

function tokenAttachment(output) {
  return {
    WFSerializationType: 'WFTextTokenAttachment',
    Value: output,
  };
}

function tokenString(value, attachmentsByIndex) {
  const attachmentsByRange = {};
  for (const [index, attachment] of Object.entries(attachmentsByIndex)) {
    attachmentsByRange[`{${index}, 1}`] = attachment;
  }

  return {
    WFSerializationType: 'WFTextTokenString',
    Value: {
      string: value,
      attachmentsByRange,
    },
  };
}

function tokenStringFromParts(parts) {
  let string = '';
  const attachmentsByRange = {};

  for (const part of parts) {
    if (typeof part === 'string') {
      string += part;
    } else {
      const index = string.length;
      string += OBJECT_REPLACEMENT;
      attachmentsByRange[`{${index}, 1}`] = part;
    }
  }

  return {
    WFSerializationType: 'WFTextTokenString',
    Value: {
      string,
      attachmentsByRange,
    },
  };
}

function plist(value) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
${xmlValue(value, 0)}
</plist>
`;
}

function xmlValue(value, depth) {
  const pad = '  '.repeat(depth);
  const childPad = '  '.repeat(depth + 1);

  if (Buffer.isBuffer(value)) return `${pad}<data></data>`;
  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}<array/>`;
    return `${pad}<array>\n${value.map((item) => xmlValue(item, depth + 1)).join('\n')}\n${pad}</array>`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) return `${pad}<dict/>`;
    return `${pad}<dict>\n${entries
      .map(([key, val]) => `${childPad}<key>${escapeXml(key)}</key>\n${xmlValue(val, depth + 1)}`)
      .join('\n')}\n${pad}</dict>`;
  }
  if (typeof value === 'boolean') return `${pad}<${value ? 'true' : 'false'}/>`;
  if (typeof value === 'number' && Number.isInteger(value)) return `${pad}<integer>${value}</integer>`;
  if (typeof value === 'number') return `${pad}<real>${value}</real>`;
  return `${pad}<string>${escapeXml(String(value))}</string>`;
}

function escapeXml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function uuid() {
  return randomUUID().toUpperCase();
}

function safeFileName(name) {
  return name.replaceAll('/', '-').replaceAll(':', '-');
}

function checkCommand(command) {
  try {
    execFileSync('which', [command], { stdio: 'ignore' });
  } catch {
    fail(`Required command not found: ${command}`);
  }
}

function parseArgs(rawArgs) {
  const parsed = {
    allowPlaceholder: false,
    open: false,
    sign: false,
    outDir: undefined,
    secret: undefined,
  };

  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (arg === '--allow-placeholder') parsed.allowPlaceholder = true;
    else if (arg === '--open') parsed.open = true;
    else if (arg === '--sign') parsed.sign = true;
    else if (arg === '--out-dir') parsed.outDir = requireValue(rawArgs, ++i, '--out-dir');
    else if (arg === '--secret') parsed.secret = requireValue(rawArgs, ++i, '--secret');
    else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: PHONE_GATEWAY_SECRET=... node scripts/iphone-shortcuts/generate.mjs [options]

Options:
  --out-dir <path>       Output directory. Defaults to ${DEFAULT_OUT_DIR}
  --secret <value>       Secret value. Prefer PHONE_GATEWAY_SECRET to avoid shell history.
  --sign                 Sign generated plists with shortcuts sign.
  --open                 Open signed shortcuts for import. Requires --sign.
  --allow-placeholder    Allow ${SECRET_PLACEHOLDER} output for review only.
`);
      process.exit(0);
    } else {
      fail(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function requireValue(rawArgs, index, name) {
  const value = rawArgs[index];
  if (!value || value.startsWith('--')) fail(`${name} requires a value.`);
  return value;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
