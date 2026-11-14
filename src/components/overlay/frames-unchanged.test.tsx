// @vitest-environment happy-dom
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createElement, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import tailwind from '../../../tailwind.config';
import { DialogFrame } from './DialogFrame';

/**
 * §12.160, rule 1. `DialogFrame` is every window's, and phSheet is a variant of it that only the
 * phone's truck sheet and More sheet take. Every other window opens and closes as §12.148 says,
 * with the animation names and lengths it had before phase 3bt:
 *
 * - **What each frame is given**, read from each file's own source (its syntax tree, not a text
 *   search): only those two pass `sheet`.
 * - **What a frame without it does**: the scrim fades in and the panel rises, by these classes,
 *   and a close leaves a copy that fades; and what those classes are, in `tailwind.config.ts`.
 * - **A sheet closed by anything but a person** leaves a window's copy too.
 *
 * In Chromium, each window this table can reach is opened and closed and its computed animation
 * read, before and after this phase: `e2e/new-motion.spec.ts`, "phase 3bt".
 */

const ROOT = join(__dirname, '..');
const SHEETS = ['console/phone/PhoneMoreSheet.tsx', 'console/phone/TruckSheet.tsx'];

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [path] : [];
  });

/** Every `<DialogFrame …>` in a file, with the names of the props it is given. */
function framesIn(path: string): string[][] {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const frames: string[][] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(source) === 'DialogFrame'
    ) {
      frames.push(
        node.attributes.properties.map((p) =>
          ts.isJsxAttribute(p) ? p.name.getText(source) : `...${p.getText(source)}`,
        ),
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return frames;
}

describe('only the phone’s two sheets take the sheet variant (§12.160, rule 1)', () => {
  const files = walk(ROOT)
    .map((path) => ({ file: relative(ROOT, path), frames: framesIn(path) }))
    .filter(({ frames }) => frames.length > 0);

  it('the frames, file by file, as phase 3bc left them: 18 in 15 files', () => {
    expect(Object.fromEntries(files.map(({ file, frames }) => [file, frames.length]))).toEqual({
      'console/AddToListModal.tsx': 1,
      'console/BulkActionModal.tsx': 1,
      'console/TruckListEditor.tsx': 1,
      'console/TruckTimeline.tsx': 1,
      'console/phone/PhoneMoreSheet.tsx': 1,
      'console/phone/TruckSheet.tsx': 1,
      'edit/ClearStopConfirm.tsx': 1,
      'edit/DiscardConfirm.tsx': 1,
      'edit/EditStopModal.tsx': 2,
      'edit/PreviousLoadQuestion.tsx': 1,
      'edit/ReachedStopQuestion.tsx': 1,
      'edit/ReassignConfirm.tsx': 1,
      'edit/ReopenConfirm.tsx': 1,
      'history/PhoneHistory.tsx': 2,
      'overlay/OverlayLayer.tsx': 1,
    });
  });

  it('the truck sheet and More pass `sheet`; no other frame does, nor spreads props that could', () => {
    const given = files.flatMap(({ file, frames }) =>
      frames.map((props) => ({
        file,
        sheet: props.includes('sheet'),
        spread: props.some((p) => p.startsWith('...')),
      })),
    );
    expect(given.filter((g) => g.sheet).map((g) => g.file)).toEqual(SHEETS);
    expect(given.filter((g) => g.spread)).toEqual([]);
  });
});

describe('a frame without it is §12.148’s, as before (§12.160, rule 1)', () => {
  it('the classes it uses mean what they meant: 220ms in, 140ms out', () => {
    const animation = (tailwind.theme?.extend as { animation: Record<string, string> }).animation;
    expect({
      'dialog-in': animation['dialog-in'],
      'scrim-in': animation['scrim-in'],
      'window-out': animation['window-out'],
    }).toEqual({
      'dialog-in': 'dialog-in 220ms cubic-bezier(.22,.61,.36,1) backwards',
      'scrim-in': 'fade-in 220ms linear backwards',
      'window-out': 'fade-away 140ms linear forwards',
    });
  });

  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.querySelectorAll('[data-dialog-fading]').forEach((n) => n.remove());
  });

  const frame = (sheet: boolean) =>
    function Window() {
      const closedByPerson = useRef(false);
      const backdrop = <button type="button" className="bg-scrim" />;
      return sheet ? (
        <DialogFrame className="fixed inset-0 z-40" panelClassName="panel" role="dialog" backdrop={backdrop} sheet={closedByPerson}>
          Words
        </DialogFrame>
      ) : (
        <DialogFrame className="fixed inset-0 z-40" panelClassName="panel" role="dialog" backdrop={backdrop}>
          Words
        </DialogFrame>
      );
    };

  it('opens with the scrim fading in and the panel rising, and closes leaving a copy that fades', async () => {
    act(() => root.render(createElement(frame(false))));
    const scrim = container.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(scrim.className).toBe('fixed inset-0 z-40 animate-scrim-in');
    expect(scrim.lastElementChild!.className).toBe('panel animate-dialog-in');
    expect(scrim.firstElementChild!.className).toBe('bg-scrim');
    await act(async () => root.render(createElement('div')));
    const copy = document.querySelector('[data-dialog-fading]')!;
    // The opening's classes come off the copy, which fades from where it stood.
    expect(copy.className).toBe('fixed inset-0 z-40 pointer-events-none animate-window-out');
    expect(copy.querySelector('[class*="animate-sheet"]')).toBeNull();
  });

  it('a sheet closed by anything but a person leaves a window’s copy, not one that goes down', async () => {
    act(() => root.render(createElement(frame(true))));
    const scrim = container.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(scrim.lastElementChild!.className).toBe('panel animate-sheet-in');
    // Unmounted with its "a person closed me" never set: a page change, say.
    await act(async () => root.render(createElement('div')));
    const copy = document.querySelector('[data-dialog-fading]')!;
    expect(copy.className).toBe('fixed inset-0 z-40 pointer-events-none animate-window-out');
    expect(copy.querySelector('[class*="animate-sheet"]')).toBeNull();
  });
});
