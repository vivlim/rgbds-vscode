'use strict';

import { HoverProvider, TextDocument, Position, CancellationToken, ProviderResult, Hover, MarkdownString, SymbolKind, workspace } from 'vscode';
import { ASMSymbolDocumenter, DefineType } from './symbolDocumenter';
import { syntaxInfo } from './syntaxInfo';

const hexRegex = /^\$([\da-fA-F][_\da-fA-F]*)$/;
const binaryRegex = /^\%([01][_01]*)$/;
const octalRegex = /^\&([0-7][_0-7]*)$/;
const integerRegex = /^(\d[_\d]*)$/;
const fixedRegex = /^(\d[_\d]*\.\d+)$/;
const hoverRegex = /(\$[\da-fA-F][_\da-fA-F]*)|(\%[01][_01]*)|(\&[0-7][_0-7]*)|(\`[0-3][_0-3]*)|(\d[_\d]*(\.\d+)?)|(\.?[A-Za-z_]\w*(\\@|:*))/g;

export class ASMHoverProvider implements HoverProvider {
  private readonly instructionMap = new Map<string, any>();

  constructor(public symbolDocumenter: ASMSymbolDocumenter) {
    const instructions = syntaxInfo.instructionsJSON.instructions;

    for (const instruction of instructions) {
      this.instructionMap.set(instruction.name, instruction);
    }
  }

  async provideHover(document: TextDocument, position: Position, token: CancellationToken): Promise<Hover | undefined | null> {
    const range = document.getWordRangeAtPosition(position, hoverRegex);
    if (range) {
      const text = document.getText(range);
      const symbol = this.symbolDocumenter.symbol(text, document);
      let numberValue: number | undefined = undefined;
      if (symbol !== undefined && symbol.documentation !== undefined) {
        return new Hover(new MarkdownString(symbol.documentation), range);
      } else if (hexRegex.test(text)) {
        numberValue = parseInt(hexRegex.exec(text)![1].replace(/_/, ""), 16);
      } else if (binaryRegex.test(text)) {
        numberValue = parseInt(binaryRegex.exec(text)![1].replace(/_/, ""), 2);
      } else if (octalRegex.test(text)) {
        numberValue = parseInt(octalRegex.exec(text)![1].replace(/_/, ""), 8);
      } else if (integerRegex.test(text) && !fixedRegex.test(text)) {
        numberValue = parseInt(text.replace(/_/, ""));
      }

      if (numberValue !== undefined) {
        return new Hover(`\`${numberValue}\`\n\n\`\$${numberValue.toString(16)}\`\n\n\`%${numberValue.toString(2)}\``, range);
      }

      let line = document.lineAt(position.line).text.trim();
      // strip comments
      // attempt to parse an instruction.
      // don't try to do multiple instructions on one line (separated by ::)

      let matches = line.match(/^\s*(\S+)(?:|\s+(\S+|\[.*\]))(?:|,\s+(\S+|\[.*\]))\s*(?:\;\s*(.*)|)$/)
      line = line.replace(/;.*$/, "");
      if (!matches) { return null; }
      const instruction = matches[1];
      const arg1 = matches[2];
      const arg2 = matches[3];

      // Check if the hovered word is the instruction. If so, try to look up the instruction by looking at the whole statement.
      if (instruction === text) {
        const candidates = [];
        // Try to normalize the arguments and look up the instruction in the map.
        if (instruction && arg1 && arg2) {
          const arg1Symbol = await this.normalizeArgument(arg1, document);
          const arg2Symbol = await this.normalizeArgument(arg2, document);
          for (const a1 of arg1Symbol) {
            for (const a2 of arg2Symbol) {
              candidates.push(`${instruction.toLowerCase()} ${a1}, ${a2}`);
            }
          }
        }
        else if (instruction && arg1) {
          const arg1Symbol = await this.normalizeArgument(arg1, document);
          for (const a of arg1Symbol) {
            candidates.push(`${instruction.toLowerCase()} ${a}`);
          }
        }
        else if (instruction) {
          candidates.push(instruction.toLowerCase());
        }
        
        for (const query of candidates) {
          // If we have a query, see if we have a matching instruction.
          const instructionInfo = this.instructionMap.get(query);
          
          if (instructionInfo) {
            const nameLine = `\`${instructionInfo.name}\``;
            const descriptionLine = instructionInfo.description;
            const cyclesLine = `**Cycles:** ${instructionInfo.cycles} **Bytes:** ${instructionInfo.bytes}`;
            const flagsLine = `**Flags:**`;
            const flagLines: string[] = [];
            if ((instructionInfo.flags.z || "").length > 0) {
              flagLines.push(`\\- Z: ${instructionInfo.flags.z}`);
            }
            if ((instructionInfo.flags.n || "").length > 0) {
              flagLines.push(`\\- N: ${instructionInfo.flags.n}`);
            }
            if ((instructionInfo.flags.h || "").length > 0) {
              flagLines.push(`\\- H: ${instructionInfo.flags.h}`);
            }
            if ((instructionInfo.flags.c || "").length > 0) {
              flagLines.push(`\\- C: ${instructionInfo.flags.c}`);
            }
            const lines = [nameLine, descriptionLine, "", cyclesLine];
            if (flagLines.length > 0) {
              lines.push(flagsLine);
              flagLines.forEach((line) => {
                lines.push(line);
              });
            }
            const md = new MarkdownString(lines.join("  \\\n"));

            return new Hover(md, range);
          }
        }
        const lines = [`*No information found for \`${text}\`.*`, "Tried searching for:"].concat(candidates.map((x) => `- \`${x}\``));
        const md = new MarkdownString(lines.join("  \n"));
        return new Hover(md, range);
      }
    }
    return null;
  }

  private async normalizeArgument(arg: string, document: TextDocument): Promise<string[]> {
    if (arg.startsWith("[") && arg.endsWith("]")) {
      var candidates = await this.normalizeArgumentInner(arg.substring(1, arg.length - 1), document);
      // Return a list of all the candidates wrapped with brackets, followed by without
      return candidates.map((x) => `[${x}]`).concat(candidates);
    }
    else {
      return await this.normalizeArgumentInner(arg, document);
    }
  }
  private async normalizeArgumentInner(arg: string, document: TextDocument): Promise<string[]> {
    /* Abbreviations:
    r8
        Any of the 8-bit registers (A, B, C, D, E, H, L).
    r16
        Any of the general-purpose 16-bit registers (BC, DE, HL).
    n8
        8-bit integer constant.
    n16
        16-bit integer constant.
    e8
        8-bit offset (-128 to 127).
    u3
        3-bit unsigned integer constant (0 to 7).
    cc
        Condition codes:

        Z
            Execute if Z is set.
        NZ
            Execute if Z is not set.
        C
            Execute if C is set.
        NC
            Execute if C is not set.
        ! cc
            Negates a condition code.

    vec
        One of the RST vectors (0x00, 0x08, 0x10, 0x18, 0x20, 0x28, 0x30, and 0x38).

    */
    
    const candidates = new Set<string>();

    // See if it is a symbol
    const argSymbol = this.symbolDocumenter.symbol(arg, document);

    if (argSymbol) {
      if (argSymbol.kind === SymbolKind.Constant) {
        // TODO: look at the number to determine which are possible?
        if (argSymbol.defineType === DefineType.Variable) {
        } else if (argSymbol.defineType === DefineType.NumericConstant) {
        } else if (argSymbol.defineType === DefineType.OffsetConstant) {
        } else if (argSymbol.defineType === DefineType.StringConstant) {
        }
        candidates.add("n8");
        candidates.add("n16");
        candidates.add("e8");
        candidates.add("u3");
      }
    }

    if (arg.match(/^[abcdehl]$/i)) {
      // 8-bit register
      candidates.add("r8");
    }

    if (arg.match(/^[bc|de|hl]$/i)) {
      // 16-bit register
      candidates.add("r16");
    }

    if (arg.match(/^[z|nz|c|nc]$/i)) {
      // Condition code
      candidates.add("cc");
    }

    // If it is a number, do some checks
    if (!isNaN(arg as any)) {
      const numberArg = parseInt(arg);
      // well, just add all the candidates now.
      candidates.add("n8");
      candidates.add("n16");
      candidates.add("e8");
      candidates.add("u3");
    }
    
    if (candidates.size === 0) {
      // OK just start throwing everything at the wall in the hopes we get a match!
      return ["n8", "n16", "e8", "u3"];
    }


    return Array.from(candidates);
  }
}
