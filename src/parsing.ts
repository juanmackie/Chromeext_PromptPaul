// src/parsing.ts - Improved parsing functionality for thinking blocks

export interface ContentSegment {
  type: 'text' | 'thinking';
  content: string;
  children?: ContentSegment[]; // For handling nested thoughts
}

/**
 * Parses a string with <thinking> tags into a structured array.
 * This version uses a simple regex split, good for non-nested thoughts.
 */
export function parseThinkingSimple(text: string): ContentSegment[] {
  if (!text) return [];

  const segments: ContentSegment[] = [];
  // Split on all tag formats - support <thinking>, ◁think▷, and their closing variants
  const parts = text.split(/(<thinking>|<\/thinking>|◁think▷|◁\/think▷|◁\/thinking▷)/g);

  for (let i = 0; i < parts.length; i++) {
    const content = parts[i];
    if (!content) continue;

    // If i is odd, it's inside a thinking tag (any format)
    if (i % 2 === 1) {
      segments.push({ type: 'thinking', content });
    } else {
      segments.push({ type: 'text', content });
    }
  }
  return segments;
}

/**
 * Parses a string with potentially nested <thinking> tags using DOMParser.
 * This version properly handles nested tags and converts them to a hierarchical structure.
 */
export function parseThinkingRecursive(text: string): ContentSegment[] {
  if (!text) return [];

  // Wrap the text in a root element to ensure it's well-formed XML
  const wrappedText = `<root>${text}</root>`;

  const parser = new DOMParser();
  const doc = parser.parseFromString(wrappedText, "text/xml");

  // Check for parsing errors
  const parserError = doc.querySelector("parsererror");
  if (parserError) {
    console.error("XML parsing error:", parserError.textContent);
    // Fallback to simple parsing if XML parsing fails
    return parseThinkingSimple(text);
  }

  const root = doc.documentElement;
  return processNodesRecursive(root);
}

/**
 * Recursively processes nodes to build ContentSegment hierarchy
 */
function processNodesRecursive(node: Node): ContentSegment[] {
  const segments: ContentSegment[] = [];

  // Process each child node
  for (let i = 0; i < node.childNodes.length; i++) {
    const childNode = node.childNodes[i];

    if (childNode.nodeType === Node.TEXT_NODE) {
      const textContent = childNode.textContent?.trim();
      if (textContent) {
        segments.push({ type: 'text', content: textContent });
      }
    } else if (childNode.nodeType === Node.ELEMENT_NODE) {
      const element = childNode as Element;
      
      if (element.tagName.toLowerCase() === 'thinking') {
        // Process the content inside the thinking tag
        const childSegments = Array.from(element.childNodes).map(child => processNodesRecursive(child)).flat();
        
        segments.push({
          type: 'thinking',
          content: '', // We'll use child segments instead of a single content string
          children: childSegments
        });
      } else {
        // For other elements, process their content
        const childSegments = processNodesRecursive(element);
        segments.push(...childSegments);
      }
    }
  }

  return segments;
}

/**
 * Flattens a nested ContentSegment structure back to a simple array
 */
function flattenSegments(segments: ContentSegment[], depth: number = 0): ContentSegment[] {
  const flattened: ContentSegment[] = [];
  
  for (const segment of segments) {
    if (segment.children && segment.children.length > 0) {
      // Add the parent thinking segment
      flattened.push({
        type: 'thinking',
        content: '', // Content will be derived from children
        children: segment.children
      });
      
      // Flatten children with appropriate depth indentation if needed
      const childSegments = flattenSegments(segment.children, depth + 1);
      flattened.push(...childSegments);
    } else {
      flattened.push(segment);
    }
  }
  
  return flattened;
}

/**
 * Improved parsing function that handles both simple and nested <thinking> tags
 */
export function parseThinkingContent(content: string): ContentSegment[] {
  if (!content) return [];
  
  // First check if we have nested tags by counting opening vs closing tags for all formats
  const openTags = (content.match(/<thinking>|◁think▷/gi) || []).length;
  const closeTags = (content.match(/<\/thinking>|◁\/think▷|◁\/thinking▷/gi) || []).length;
  
  if (openTags !== closeTags) {
    console.warn('Unbalanced thinking tags detected, using simple parsing');
    return parseThinkingSimple(content);
  }
  
  // If we have nested tags, use recursive parsing
  if (openTags > 1) {
    return parseThinkingRecursive(content);
  }
  
  // Otherwise, use simple parsing
  return parseThinkingSimple(content);
}

/**
 * Stack-based parser for nested thinking tags that properly handles complex nesting.
 * This is more robust than the DOMParser approach for complex or malformed content.
 */
export function parseNestedThinking(content: string): ContentSegment[] {
  if (!content) return [];

  const segments: ContentSegment[] = [];
  const stack: { type: 'text' | 'thinking', content: string, children: ContentSegment[] }[] = [];
  let currentText = '';
  let i = 0;

  while (i < content.length) {
    // Look for the next tag - support all formats
    const thinkingStart1 = content.indexOf('<thinking>', i);
    const thinkingStart2 = content.indexOf('◁think▷', i);
    const thinkingEnd1 = content.indexOf('</thinking>', i);
    const thinkingEnd2 = content.indexOf('◁/think▷', i);
    const thinkingEnd3 = content.indexOf('◁/thinking▷', i);
    
    // Find the earliest occurring tag
    let nextTagPos = -1;
    let isStartTag = false;
    let tagLength = 0;
    
    // Check start tags
    const earliestStart = thinkingStart1 !== -1 && thinkingStart2 !== -1 
      ? Math.min(thinkingStart1, thinkingStart2)
      : (thinkingStart1 !== -1 ? thinkingStart1 : thinkingStart2);
    
    // Check end tags  
    const earliestEnd = [thinkingEnd1, thinkingEnd2, thinkingEnd3]
      .filter(pos => pos !== -1)
      .reduce((min, pos) => pos < min ? pos : min, Infinity);
    
    if (earliestStart !== -1 && (earliestEnd === Infinity || earliestStart < earliestEnd)) {
      nextTagPos = earliestStart;
      isStartTag = true;
      tagLength = (earliestStart === thinkingStart1) ? 10 : 7; // <thinking> = 10, ◁think▷ = 7
    } else if (earliestEnd !== Infinity) {
      nextTagPos = earliestEnd;
      isStartTag = false;
      // Determine tag length based on which end tag we found
      if (earliestEnd === thinkingEnd1) {
        tagLength = 11; // </thinking> = 11
      } else if (earliestEnd === thinkingEnd2) {
        tagLength = 8; // ◁/think▷ = 8
      } else {
        tagLength = 10; // ◁/thinking▷ = 10
      }
    }
    
    if (nextTagPos === -1) {
      // No more tags, add remaining content as text
      if (currentText || stack.length === 0) {
        const textToAdd = currentText + content.substring(i);
        if (textToAdd.trim()) {
          if (stack.length > 0) {
            stack[stack.length - 1].content += textToAdd;
          } else {
            segments.push({ type: 'text', content: textToAdd });
          }
        }
      }
      break;
    }
    
    // Add content before the tag
    const contentBeforeTag = content.substring(i, nextTagPos);
    if (stack.length > 0) {
      stack[stack.length - 1].content += contentBeforeTag;
    } else {
      currentText += contentBeforeTag;
    }
    
    if (isStartTag) {
      // Process start tag
      if (currentText) {
        if (stack.length > 0) {
          stack[stack.length - 1].content += currentText;
        } else {
          segments.push({ type: 'text', content: currentText });
        }
        currentText = '';
      }
      
      // Push a new thinking container to the stack
      stack.push({
        type: 'thinking',
        content: '',
        children: []
      });
    } else {
      // Process end tag
      if (stack.length > 0) {
        const top = stack.pop()!;
        if (stack.length > 0) {
          // Add the popped thinking as a child to the new top
          stack[stack.length - 1].children.push({
            type: 'thinking',
            content: top.content,
            children: top.children
          });
        } else {
          // Stack is empty, add to main segments
          segments.push({
            type: 'thinking',
            content: top.content,
            children: top.children
          });
        }
      } else {
        // Unmatched closing tag, treat as text
        const tagText = content.substring(nextTagPos, nextTagPos + tagLength);
        currentText += tagText;
      }
    }
    
    i = nextTagPos + tagLength; // Skip past the tag
  }
  
  // Add any remaining text if there's no active thinking block
  if (currentText && stack.length === 0) {
    segments.push({ type: 'text', content: currentText });
  } else if (currentText && stack.length > 0) {
    stack[stack.length - 1].content += currentText;
  }
  
  // Handle any unclosed tags
  if (stack.length > 0) {
    console.warn('Unclosed thinking tags detected, treating remaining content as text');
    let remainingContent = '';
    while (stack.length > 0) {
      const top = stack.pop()!;
      remainingContent = top.content + remainingContent;
    }
    if (remainingContent) {
      segments.push({ type: 'text', content: remainingContent });
    }
  }
  
  return segments;
}

/**
 * Enhanced parsing function that handles both simple and complex cases
 */
export function parseThinkingEnhanced(content: string): ContentSegment[] {
  // First, try to extract content between all thinking tag formats
  // Improved regex pattern with better matching and explicit capture groups
  const thinkingRegex = /(?:<thinking>([\s\S]*?)<\/thinking>|(◁think▷[\s\S]*?◁\/think▷)|(◁think▷[\s\S]*?◁\/thinking▷))/gi;
  let match;
  const segments: ContentSegment[] = [];
  
  let lastIndex = 0;
  
  while ((match = thinkingRegex.exec(content)) !== null) {
    // Add text before the thinking tag
    if (match.index > lastIndex) {
      const textBefore = content.substring(lastIndex, match.index);
      if (textBefore.trim()) {
        segments.push({ type: 'text', content: textBefore });
      }
    }
    
    // Add the thinking content - match[1] is for <thinking> tags, match[2] and match[3] are for ◁think▷ tags
    let thinkingContent = '';
    if (match[1]) {
      // <thinking> tags
      thinkingContent = match[1].trim();
    } else if (match[2]) {
      // ◁think▷◁/think▷ tags
      thinkingContent = match[2].trim();
    } else if (match[3]) {
      // ◁think▷◁/thinking▷ tags
      thinkingContent = match[3].trim();
    }

    if (thinkingContent) {
      segments.push({ type: 'thinking', content: thinkingContent });
    }
    
    lastIndex = match.index + match[0].length;
  }
  
  // Add text after the last thinking tag
  if (lastIndex < content.length) {
    const remainingText = content.substring(lastIndex);
    if (remainingText.trim()) {
      segments.push({ type: 'text', content: remainingText });
    }
  }
  
  return segments;
}