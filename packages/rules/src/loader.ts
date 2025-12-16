import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

import { ChecklistItem, JurisdictionRule, JurisdictionRuleSchema, getDefaultRulesDirectory } from './schemas';

function buildKey(state: string, countyCode: string) {
  return `${state.toUpperCase()}-${countyCode.toUpperCase()}`;
}

export class RulesRegistry {
  private rules = new Map<string, JurisdictionRule>();
  private basePath: string;

  constructor(basePath?: string) {
    this.basePath = basePath ?? getDefaultRulesDirectory(__dirname);
    this.loadRules();
  }

  private loadRules() {
    const statesRoot = fs.existsSync(this.basePath)
      ? this.basePath
      : getDefaultRulesDirectory(process.cwd());

    const stateDirs = fs.readdirSync(statesRoot, { withFileTypes: true }).filter((dir) => dir.isDirectory());

    stateDirs.forEach((stateDir) => {
      const countyRoot = path.join(statesRoot, stateDir.name, 'counties');
      if (!fs.existsSync(countyRoot)) return;

      const countyFiles = fs
        .readdirSync(countyRoot, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.yaml'));

      countyFiles.forEach((file) => {
        const filePath = path.join(countyRoot, file.name);
        const parsed = yaml.load(fs.readFileSync(filePath, 'utf-8'));
        const rule = JurisdictionRuleSchema.parse(parsed);
        const key = buildKey(rule.state, rule.county_code);
        this.rules.set(key, rule);
      });
    });
  }

  listJurisdictions() {
    return Array.from(this.rules.values()).map((rule) => ({
      state: rule.state,
      county_code: rule.county_code,
      county_name: rule.county_name,
      enabled: rule.feature_flags.enabled,
      feature_flags: rule.feature_flags,
    }));
  }

  getRule(state: string, countyCode: string): JurisdictionRule | undefined {
    return this.rules.get(buildKey(state, countyCode));
  }

  getChecklistItems(state: string, countyCode: string): ChecklistItem[] {
    const rule = this.getRule(state, countyCode);

    if (!rule) {
      throw new Error(`No rules found for ${state}/${countyCode}`);
    }

    const jurisdiction = {
      state: rule.state,
      county_code: rule.county_code,
      county_name: rule.county_name,
    };

    const documentItems: ChecklistItem[] = rule.required_documents.map((doc) => ({
      ...doc,
      type: 'document',
      jurisdiction,
    }));

    const formItems: ChecklistItem[] = rule.forms.map((form) => ({
      id: form.id,
      title: form.name,
      description: form.description ?? 'Official reference form',
      required: true,
      jurisdiction,
      type: 'form',
    }));

    return [...documentItems, ...formItems];
  }
}
