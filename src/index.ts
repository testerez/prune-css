import { Rule, AtRule, stringify, parse } from 'css';
// tslint:disable-next-line:import-blacklist

const getRuleSelectors = (rule: any): string[] | undefined => {
  switch (rule.type) {
    case 'rule':
      return rule.selectors;
    case 'media':
      return rule.rules.reduce((acc: string[], rule: any) => {
        acc.push.apply(acc, rule.selectors);
        return acc;
      }, []);
  }
};

const getMatchs = (re: RegExp, s: string) => {
  const result = [];
  let m: string[] | null;
  while ((m = re.exec(s))) {
    result.push(m);
  }
  return result;
};

const getSelectorMatchs = (
  selector: string,
): { ids?: string[]; classes?: string[] } => {
  // for example if selector is `div.foo .bar` then the css should be included
  // only if the page contains `.foo` (`.bar` can be ignored)
  const singleIdOrClassMatch = selector.match(/^[a-z\s]*([.#])([\w\d-]+)/i);
  if (singleIdOrClassMatch) {
    const [, modifier, name] = singleIdOrClassMatch;
    return modifier === '.' ? { classes: [name] } : { ids: [name] };
  }

  // remove any :not()
  selector = selector.replace(/\:not\([^)]*\)/g, '');

  // To be safe for more complex selectors, we extract any id or classe present in the selector
  return {
    classes: getMatchs(/\.([\w\d-]+)/gi, selector).map(m => m[1]),
    ids: getMatchs(/\#([\w\d-]+)/gi, selector).map(m => m[1]),
  };
};

const parseSelectors = (selectors: string[]) => {
  const classes = [] as string[];
  const ids = [] as string[];
  selectors.map(getSelectorMatchs).forEach(matchs => {
    if (matchs.classes) {
      matchs.classes.forEach(m => classes.push(m));
    }
    if (matchs.ids) {
      matchs.ids.forEach(m => ids.push(m));
    }
  });
  return { classes, ids };
};

type CandidateRule = {
  classes?: string[];
  ids?: string[];
  alwaysInclude?: boolean;
  css: string;
};

const getRuleCss = (rule: any, compress: boolean) =>
  stringify(
    {
      type: 'stylesheet',
      stylesheet: {
        rules: [rule],
      },
    },
    { compress },
  );

const processRule = (compress: boolean) => (
  rule: Rule | AtRule,
): CandidateRule => {
  const css = getRuleCss(rule, compress);
  const selectors = getRuleSelectors(rule);
  const selectorElements = parseSelectors(selectors || []);
  if (!selectorElements.classes.length && !selectorElements.ids.length) {
    return { css, alwaysInclude: true };
  }
  return {
    css,
    ...selectorElements,
  };
};

const classNamesRegexp = /\bclass\s*=\s*["']([^"']+)["']/gi;
const extractClassnames = (html: string) =>
  getMatchs(classNamesRegexp, html).reduce((set, m) => {
    m[1].split(/\s+/).forEach(className => set.add(className));
    return set;
  }, new Set<string>());

export default (allCss: string, compress: boolean = true) => {
  const parsed = parse(allCss, { silent: true });
  if (!parsed.stylesheet) {
    throw new Error('No stylesheet found');
  }
  const candidateRules: CandidateRule[] = [
    ...parsed.stylesheet.rules.map(processRule(compress)),
    ...(parsed.stylesheet.parsingErrors || []).filter(e => e.source).map(e => ({
      alwaysInclude: true,
      css: e.source!,
    })),
  ];

  return (html: string) => {
    const classnames = extractClassnames(html);
    return candidateRules
      .filter(
        rule =>
          rule.alwaysInclude ||
          rule.classes!.find(classname => classnames.has(classname)),
      )
      .map(rule => rule.css)
      .join(compress ? '' : '\n');
  };
};
