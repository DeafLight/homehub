import { describe, expect, it } from 'vitest';
import { HOMEWORK_TEXT_MAX, homeworkFrom, htmlToText, sortHomework } from './homework.ts';

const hw = (id: string, due: string, subject = id) => ({ id, subject, due, text: '', done: false });

describe('htmlToText', () => {
  it('garde les paragraphes et les listes, retire balises et entités', () => {
    expect(htmlToText('<p>Exercices&nbsp;:</p><ul><li>n°&#160;3</li><li>n° 4 &amp; 5</li></ul><script>x()</script>')).toBe(
      'Exercices :\n• n° 3\n• n° 4 & 5',
    );
    expect(htmlToText('Ligne 1<br/>  Ligne   2<br><br>')).toBe('Ligne 1\nLigne 2');
    expect(htmlToText('&lt;b&gt; &eacute;t&eacute; &#x2019;')).toBe('<b> été ’');
  });

  it('coupe une consigne trop longue', () => {
    const text = htmlToText('a'.repeat(HOMEWORK_TEXT_MAX + 50));
    expect(text).toHaveLength(HOMEWORK_TEXT_MAX);
    expect(text.endsWith('…')).toBe(true);
  });
});

describe('tri et fenêtre', () => {
  it('trie par jour puis matière, et garde aujourd’hui et la suite', () => {
    const list = [hw('b', '2026-11-04', 'Maths'), hw('a', '2026-11-04', 'Anglais'), hw('c', '2026-11-03'), hw('old', '2026-11-01')];
    expect(sortHomework(list).map((h) => h.id)).toEqual(['old', 'c', 'a', 'b']);
    expect(homeworkFrom(list, new Date(2026, 10, 3, 20, 0)).map((h) => h.id)).toEqual(['b', 'a', 'c']);
  });
});
