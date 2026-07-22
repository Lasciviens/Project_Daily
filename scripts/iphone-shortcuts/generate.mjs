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
  buildAsk(secret),
  buildBrief(secret),
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
  const okId = uuid();

  return shortcut('Log Creatine', 'log-creatine', 61444, 4282601983, [
    postAction(requestId, phoneSecret, [
      textItem('action', 'log_supplement'),
      textItem('title', 'Kreatin 5 g'),
      numberItem('calories', 0),
    ]),
    getValueAction(loggedId, 'logged', actionOutput(requestId, 'Contents of URL')),
    {
      WFWorkflowActionIdentifier: 'is.workflow.actions.notification',
      WFWorkflowActionParameters: {
        UUID: uuid(),
        WFNotificationActionTitle: "Lasci's Board",
        WFNotificationActionBody: tokenString(`${OBJECT_REPLACEMENT} loglandi`, {
          0: actionOutput(loggedId, 'Dictionary Value'),
        }),
        WFNotificationActionSound: true,
      },
    },
    getValueAction(okId, 'ok', actionOutput(requestId, 'Contents of URL')),
  ]);
}

function buildAsk(phoneSecret) {
  const dictatedId = uuid();
  const requestId = uuid();
  const textId = uuid();
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
    getValueAction(okId, 'ok', actionOutput(requestId, 'Contents of URL')),
  ]);
}

function buildBrief(phoneSecret) {
  const requestId = uuid();
  const textId = uuid();
  const okId = uuid();

  return shortcut('Sabah Brief', 'sabah-brief', 59781, 431817727, [
    postAction(requestId, phoneSecret, [textItem('action', 'brief')]),
    getValueAction(textId, 'text', actionOutput(requestId, 'Contents of URL')),
    {
      WFWorkflowActionIdentifier: 'is.workflow.actions.notification',
      WFWorkflowActionParameters: {
        UUID: uuid(),
        WFNotificationActionTitle: 'Sabah Brief',
        WFNotificationActionBody: tokenString(OBJECT_REPLACEMENT, {
          0: actionOutput(textId, 'Dictionary Value'),
        }),
        WFNotificationActionSound: true,
      },
    },
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
