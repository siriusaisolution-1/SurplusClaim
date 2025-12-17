import { BadRequestException, Injectable } from '@nestjs/common';
import { AI_OUTPUT_RULES, UPL_DISCLAIMER } from '@surplus/shared';

import { TriageSuggestion } from '../cases/cases.service';

@Injectable()
export class LegalSafetyService {
  get disclaimer() {
    return UPL_DISCLAIMER;
  }

  validateStructuredSuggestion(suggestion: TriageSuggestion) {
    suggestion.rationale.forEach((item) => {
      if (!AI_OUTPUT_RULES.rationaleMessages.has(item)) {
        throw new BadRequestException('Unvalidated AI rationale detected');
      }
    });

    if (suggestion.confidence < 0 || suggestion.confidence > 1) {
      throw new BadRequestException('Confidence score must be between 0 and 1');
    }
  }

  validateDocType(docType: string, allowedDocTypes?: string[]) {
    const candidate = docType.trim();
    if (!/^[A-Za-z0-9_-]+$/.test(candidate)) {
      throw new BadRequestException('Unvalidated document classification value');
    }

    if (allowedDocTypes && allowedDocTypes.length > 0) {
      const matched = allowedDocTypes.some((item) => item.toLowerCase() === candidate.toLowerCase());
      if (!matched) {
        throw new BadRequestException('Document type is not permitted for this jurisdiction');
      }
    }

    return candidate;
  }
}
