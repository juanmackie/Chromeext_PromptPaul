/*
 * dom-accessibility-api 0.7.1
 * MIT License
 * Copyright (c) 2020 Sebastian Silbermann
 *
 * See libs/dom-accessibility-api.LICENSE.md for the complete license text.
 * This file is a vendored browser bundle generated from the published package.
 */
var PromptPaulDomAccessibility = (function(exports) {
	Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
	//#region package/dist/polyfills/array.from.mjs
	/**
	* @source {https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/from#Polyfill}
	* but without thisArg (too hard to type, no need to `this`)
	*/
	var toStr = Object.prototype.toString;
	function isCallable(fn) {
		return typeof fn === "function" || toStr.call(fn) === "[object Function]";
	}
	function toInteger(value) {
		var number = Number(value);
		if (isNaN(number)) return 0;
		if (number === 0 || !isFinite(number)) return number;
		return (number > 0 ? 1 : -1) * Math.floor(Math.abs(number));
	}
	var maxSafeInteger = Math.pow(2, 53) - 1;
	function toLength(value) {
		var len = toInteger(value);
		return Math.min(Math.max(len, 0), maxSafeInteger);
	}
	/**
	* Creates an array from an iterable object.
	* @param iterable An iterable object to convert to an array.
	*/
	/**
	* Creates an array from an iterable object.
	* @param iterable An iterable object to convert to an array.
	* @param mapfn A mapping function to call on every element of the array.
	* @param thisArg Value of 'this' used to invoke the mapfn.
	*/
	function arrayFrom(arrayLike, mapFn) {
		var C = Array;
		var items = Object(arrayLike);
		if (arrayLike == null) throw new TypeError("Array.from requires an array-like object - not null or undefined");
		if (typeof mapFn !== "undefined") {
			if (!isCallable(mapFn)) throw new TypeError("Array.from: when provided, the second argument must be a function");
		}
		var len = toLength(items.length);
		var A = isCallable(C) ? Object(new C(len)) : new Array(len);
		var k = 0;
		var kValue;
		while (k < len) {
			kValue = items[k];
			if (mapFn) A[k] = mapFn(kValue, k);
			else A[k] = kValue;
			k += 1;
		}
		A.length = len;
		return A;
	}
	//#endregion
	//#region package/dist/polyfills/SetLike.mjs
	function _typeof$1(o) {
		"@babel/helpers - typeof";
		return _typeof$1 = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o) {
			return typeof o;
		} : function(o) {
			return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o;
		}, _typeof$1(o);
	}
	function _classCallCheck(instance, Constructor) {
		if (!(instance instanceof Constructor)) throw new TypeError("Cannot call a class as a function");
	}
	function _defineProperties(target, props) {
		for (var i = 0; i < props.length; i++) {
			var descriptor = props[i];
			descriptor.enumerable = descriptor.enumerable || false;
			descriptor.configurable = true;
			if ("value" in descriptor) descriptor.writable = true;
			Object.defineProperty(target, _toPropertyKey$1(descriptor.key), descriptor);
		}
	}
	function _createClass(Constructor, protoProps, staticProps) {
		if (protoProps) _defineProperties(Constructor.prototype, protoProps);
		if (staticProps) _defineProperties(Constructor, staticProps);
		Object.defineProperty(Constructor, "prototype", { writable: false });
		return Constructor;
	}
	function _defineProperty$1(obj, key, value) {
		key = _toPropertyKey$1(key);
		if (key in obj) Object.defineProperty(obj, key, {
			value,
			enumerable: true,
			configurable: true,
			writable: true
		});
		else obj[key] = value;
		return obj;
	}
	function _toPropertyKey$1(t) {
		var i = _toPrimitive$1(t, "string");
		return "symbol" == _typeof$1(i) ? i : i + "";
	}
	function _toPrimitive$1(t, r) {
		if ("object" != _typeof$1(t) || !t) return t;
		var e = t[Symbol.toPrimitive];
		if (void 0 !== e) {
			var i = e.call(t, r || "default");
			if ("object" != _typeof$1(i)) return i;
			throw new TypeError("@@toPrimitive must return a primitive value.");
		}
		return ("string" === r ? String : Number)(t);
	}
	var SetLike_default = typeof Set === "undefined" ? Set : /* @__PURE__ */ function() {
		function SetLike() {
			var items = arguments.length > 0 && arguments[0] !== void 0 ? arguments[0] : [];
			_classCallCheck(this, SetLike);
			_defineProperty$1(this, "items", void 0);
			this.items = items;
		}
		return _createClass(SetLike, [
			{
				key: "add",
				value: function add(value) {
					if (this.has(value) === false) this.items.push(value);
					return this;
				}
			},
			{
				key: "clear",
				value: function clear() {
					this.items = [];
				}
			},
			{
				key: "delete",
				value: function _delete(value) {
					var previousLength = this.items.length;
					this.items = this.items.filter(function(item) {
						return item !== value;
					});
					return previousLength !== this.items.length;
				}
			},
			{
				key: "forEach",
				value: function forEach(callbackfn) {
					var _this = this;
					this.items.forEach(function(item) {
						callbackfn(item, item, _this);
					});
				}
			},
			{
				key: "has",
				value: function has(value) {
					return this.items.indexOf(value) !== -1;
				}
			},
			{
				key: "size",
				get: function get() {
					return this.items.length;
				}
			}
		]);
	}();
	//#endregion
	//#region package/dist/getRole.mjs
	/**
	* Safe Element.localName for all supported environments
	* @param element
	*/
	function getLocalName(element) {
		var _element$localName;
		return (_element$localName = element.localName) !== null && _element$localName !== void 0 ? _element$localName : element.tagName.toLowerCase();
	}
	var localNameToRoleMappings = {
		article: "article",
		aside: "complementary",
		button: "button",
		datalist: "listbox",
		dd: "definition",
		details: "group",
		dialog: "dialog",
		dt: "term",
		fieldset: "group",
		figure: "figure",
		form: "form",
		footer: "contentinfo",
		h1: "heading",
		h2: "heading",
		h3: "heading",
		h4: "heading",
		h5: "heading",
		h6: "heading",
		header: "banner",
		hr: "separator",
		html: "document",
		legend: "legend",
		li: "listitem",
		math: "math",
		main: "main",
		menu: "list",
		nav: "navigation",
		ol: "list",
		optgroup: "group",
		option: "option",
		output: "status",
		progress: "progressbar",
		section: "region",
		summary: "button",
		table: "table",
		tbody: "rowgroup",
		textarea: "textbox",
		tfoot: "rowgroup",
		td: "cell",
		th: "columnheader",
		thead: "rowgroup",
		tr: "row",
		ul: "list"
	};
	var prohibitedAttributes = {
		caption: new Set(["aria-label", "aria-labelledby"]),
		code: new Set(["aria-label", "aria-labelledby"]),
		deletion: new Set(["aria-label", "aria-labelledby"]),
		emphasis: new Set(["aria-label", "aria-labelledby"]),
		generic: new Set([
			"aria-label",
			"aria-labelledby",
			"aria-roledescription"
		]),
		insertion: new Set(["aria-label", "aria-labelledby"]),
		none: new Set(["aria-label", "aria-labelledby"]),
		paragraph: new Set(["aria-label", "aria-labelledby"]),
		presentation: new Set(["aria-label", "aria-labelledby"]),
		strong: new Set(["aria-label", "aria-labelledby"]),
		subscript: new Set(["aria-label", "aria-labelledby"]),
		superscript: new Set(["aria-label", "aria-labelledby"])
	};
	/**
	*
	* @param element
	* @param role The role used for this element. This is specified to control whether you want to use the implicit or explicit role.
	*/
	function hasGlobalAriaAttributes(element, role) {
		return [
			"aria-atomic",
			"aria-busy",
			"aria-controls",
			"aria-current",
			"aria-description",
			"aria-describedby",
			"aria-details",
			"aria-dropeffect",
			"aria-flowto",
			"aria-grabbed",
			"aria-hidden",
			"aria-keyshortcuts",
			"aria-label",
			"aria-labelledby",
			"aria-live",
			"aria-owns",
			"aria-relevant",
			"aria-roledescription"
		].some(function(attributeName) {
			var _prohibitedAttributes;
			return element.hasAttribute(attributeName) && !((_prohibitedAttributes = prohibitedAttributes[role]) !== null && _prohibitedAttributes !== void 0 && _prohibitedAttributes.has(attributeName));
		});
	}
	function ignorePresentationalRole(element, implicitRole) {
		return hasGlobalAriaAttributes(element, implicitRole);
	}
	function getRole(element) {
		var explicitRole = getExplicitRole(element);
		if (explicitRole === null || presentationRoles.indexOf(explicitRole) !== -1) {
			var implicitRole = getImplicitRole(element);
			if (presentationRoles.indexOf(explicitRole || "") === -1 || ignorePresentationalRole(element, implicitRole || "")) return implicitRole;
		}
		return explicitRole;
	}
	function getImplicitRole(element) {
		var mappedByTag = localNameToRoleMappings[getLocalName(element)];
		if (mappedByTag !== void 0) return mappedByTag;
		switch (getLocalName(element)) {
			case "a":
			case "area":
			case "link":
				if (element.hasAttribute("href")) return "link";
				break;
			case "img":
				if (element.getAttribute("alt") === "" && !ignorePresentationalRole(element, "img")) return "presentation";
				return "img";
			case "input":
				var type = element.type;
				switch (type) {
					case "button":
					case "image":
					case "reset":
					case "submit": return "button";
					case "checkbox":
					case "radio": return type;
					case "range": return "slider";
					case "email":
					case "tel":
					case "text":
					case "url":
						if (element.hasAttribute("list")) return "combobox";
						return "textbox";
					case "search":
						if (element.hasAttribute("list")) return "combobox";
						return "searchbox";
					case "number": return "spinbutton";
					default: return null;
				}
			case "select":
				if (element.hasAttribute("multiple") || element.size > 1) return "listbox";
				return "combobox";
		}
		return null;
	}
	function getExplicitRole(element) {
		var role = element.getAttribute("role");
		if (role !== null) {
			var explicitRole = role.trim().split(" ")[0];
			if (explicitRole.length > 0) return explicitRole;
		}
		return null;
	}
	//#endregion
	//#region package/dist/util.mjs
	var presentationRoles = ["presentation", "none"];
	function isElement(node) {
		return node !== null && node.nodeType === node.ELEMENT_NODE;
	}
	function isHTMLTableCaptionElement(node) {
		return isElement(node) && getLocalName(node) === "caption";
	}
	function isHTMLInputElement(node) {
		return isElement(node) && getLocalName(node) === "input";
	}
	function isHTMLOptGroupElement(node) {
		return isElement(node) && getLocalName(node) === "optgroup";
	}
	function isHTMLSelectElement(node) {
		return isElement(node) && getLocalName(node) === "select";
	}
	function isHTMLTableElement(node) {
		return isElement(node) && getLocalName(node) === "table";
	}
	function isHTMLTextAreaElement(node) {
		return isElement(node) && getLocalName(node) === "textarea";
	}
	function safeWindow(node) {
		var defaultView = (node.ownerDocument === null ? node : node.ownerDocument).defaultView;
		if (defaultView === null) throw new TypeError("no window available");
		return defaultView;
	}
	function isHTMLFieldSetElement(node) {
		return isElement(node) && getLocalName(node) === "fieldset";
	}
	function isHTMLLegendElement(node) {
		return isElement(node) && getLocalName(node) === "legend";
	}
	function isHTMLSlotElement(node) {
		return isElement(node) && getLocalName(node) === "slot";
	}
	function isSVGElement(node) {
		return isElement(node) && node.ownerSVGElement !== void 0;
	}
	function isSVGSVGElement(node) {
		return isElement(node) && getLocalName(node) === "svg";
	}
	function isSVGTitleElement(node) {
		return isSVGElement(node) && getLocalName(node) === "title";
	}
	/**
	*
	* @param {Node} node -
	* @param {string} attributeName -
	* @returns {Element[]} -
	*/
	function queryIdRefs(node, attributeName) {
		if (isElement(node) && node.hasAttribute(attributeName)) {
			var ids = node.getAttribute(attributeName).split(" ");
			var root = node.getRootNode ? node.getRootNode() : node.ownerDocument;
			return ids.map(function(id) {
				return root.getElementById(id);
			}).filter(function(element) {
				return element !== null;
			});
		}
		return [];
	}
	function hasAnyConcreteRoles(node, roles) {
		if (isElement(node)) return roles.indexOf(getRole(node)) !== -1;
		return false;
	}
	//#endregion
	//#region package/dist/accessible-name-and-description.mjs
	/**
	* implements https://w3c.github.io/accname/
	*/
	/**
	*  A string of characters where all carriage returns, newlines, tabs, and form-feeds are replaced with a single space, and multiple spaces are reduced to a single space. The string contains only character data; it does not contain any markup.
	*/
	/**
	* interface for an options-bag where `window.getComputedStyle` can be mocked
	*/
	/**
	*
	* @param {string} string -
	* @returns {FlatString} -
	*/
	function asFlatString(s) {
		return s.trim().replace(/\s\s+/g, " ");
	}
	/**
	*
	* @param node -
	* @param options - These are not optional to prevent accidentally calling it without options in `computeAccessibleName`
	* @returns {boolean} -
	*/
	function isHidden(node, getComputedStyleImplementation) {
		if (!isElement(node)) return false;
		if (node.hasAttribute("hidden") || node.getAttribute("aria-hidden") === "true") return true;
		var style = getComputedStyleImplementation(node);
		return style.getPropertyValue("display") === "none" || style.getPropertyValue("visibility") === "hidden";
	}
	/**
	* @param {Node} node -
	* @returns {boolean} - As defined in step 2E of https://w3c.github.io/accname/#mapping_additional_nd_te
	*/
	function isControl(node) {
		return hasAnyConcreteRoles(node, [
			"button",
			"combobox",
			"listbox",
			"textbox"
		]) || hasAbstractRole(node, "range");
	}
	function hasAbstractRole(node, role) {
		if (!isElement(node)) return false;
		switch (role) {
			case "range": return hasAnyConcreteRoles(node, [
				"meter",
				"progressbar",
				"scrollbar",
				"slider",
				"spinbutton"
			]);
			default: throw new TypeError("No knowledge about abstract role '".concat(role, "'. This is likely a bug :("));
		}
	}
	/**
	* element.querySelectorAll but also considers owned tree
	* @param element
	* @param selectors
	*/
	function querySelectorAllSubtree(element, selectors) {
		var elements = arrayFrom(element.querySelectorAll(selectors));
		queryIdRefs(element, "aria-owns").forEach(function(root) {
			elements.push.apply(elements, arrayFrom(root.querySelectorAll(selectors)));
		});
		return elements;
	}
	function querySelectedOptions(listbox) {
		if (isHTMLSelectElement(listbox)) return listbox.selectedOptions || querySelectorAllSubtree(listbox, "[selected]");
		return querySelectorAllSubtree(listbox, "[aria-selected=\"true\"]");
	}
	function isMarkedPresentational(node) {
		return hasAnyConcreteRoles(node, presentationRoles);
	}
	/**
	* Elements specifically listed in html-aam
	*
	* We don't need this for `label` or `legend` elements.
	* Their implicit roles already allow "naming from content".
	*
	* sources:
	*
	* - https://w3c.github.io/html-aam/#table-element
	*/
	function isNativeHostLanguageTextAlternativeElement(node) {
		return isHTMLTableCaptionElement(node);
	}
	/**
	* https://w3c.github.io/aria/#namefromcontent
	*/
	function allowsNameFromContent(node) {
		return hasAnyConcreteRoles(node, [
			"button",
			"cell",
			"checkbox",
			"columnheader",
			"gridcell",
			"heading",
			"label",
			"legend",
			"link",
			"menuitem",
			"menuitemcheckbox",
			"menuitemradio",
			"option",
			"radio",
			"row",
			"rowheader",
			"switch",
			"tab",
			"tooltip",
			"treeitem"
		]);
	}
	/**
	* TODO https://github.com/eps1lon/dom-accessibility-api/issues/100
	*/
	function isDescendantOfNativeHostLanguageTextAlternativeElement(node) {
		return false;
	}
	function getValueOfTextbox(element) {
		if (isHTMLInputElement(element) || isHTMLTextAreaElement(element)) return element.value;
		return element.textContent || "";
	}
	function getTextualContent(declaration) {
		var content = declaration.getPropertyValue("content");
		if (/^["'].*["']$/.test(content)) return content.slice(1, -1);
		return "";
	}
	/**
	* https://html.spec.whatwg.org/multipage/forms.html#category-label
	* TODO: form-associated custom elements
	* @param element
	*/
	function isLabelableElement(element) {
		var localName = getLocalName(element);
		return localName === "button" || localName === "input" && element.getAttribute("type") !== "hidden" || localName === "meter" || localName === "output" || localName === "progress" || localName === "select" || localName === "textarea";
	}
	/**
	* > [...], then the first such descendant in tree order is the label element's labeled control.
	* -- https://html.spec.whatwg.org/multipage/forms.html#labeled-control
	* @param element
	*/
	function findLabelableElement(element) {
		if (isLabelableElement(element)) return element;
		var labelableElement = null;
		element.childNodes.forEach(function(childNode) {
			if (labelableElement === null && isElement(childNode)) {
				var descendantLabelableElement = findLabelableElement(childNode);
				if (descendantLabelableElement !== null) labelableElement = descendantLabelableElement;
			}
		});
		return labelableElement;
	}
	/**
	* Polyfill of HTMLLabelElement.control
	* https://html.spec.whatwg.org/multipage/forms.html#labeled-control
	* @param label
	*/
	function getControlOfLabel(label) {
		if (label.control !== void 0) return label.control;
		var htmlFor = label.getAttribute("for");
		if (htmlFor !== null) return label.ownerDocument.getElementById(htmlFor);
		return findLabelableElement(label);
	}
	/**
	* Polyfill of HTMLInputElement.labels
	* https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/labels
	* @param element
	*/
	function getLabels(element) {
		var labelsProperty = element.labels;
		if (labelsProperty === null) return labelsProperty;
		if (labelsProperty !== void 0) return arrayFrom(labelsProperty);
		if (!isLabelableElement(element)) return null;
		var document = element.ownerDocument;
		return arrayFrom(document.querySelectorAll("label")).filter(function(label) {
			return getControlOfLabel(label) === element;
		});
	}
	/**
	* Gets the contents of a slot used for computing the accname
	* @param slot
	*/
	function getSlotContents(slot) {
		var assignedNodes = slot.assignedNodes();
		if (assignedNodes.length === 0) return arrayFrom(slot.childNodes);
		return assignedNodes;
	}
	/**
	* implements https://w3c.github.io/accname/#mapping_additional_nd_te
	* @param root
	* @param options
	* @returns
	*/
	function computeTextAlternative(root) {
		var options = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
		var consultedNodes = new SetLike_default();
		var computedStyles = typeof Map === "undefined" ? void 0 : /* @__PURE__ */ new Map();
		var window = safeWindow(root);
		var _options$compute = options.compute, compute = _options$compute === void 0 ? "name" : _options$compute, _options$computedStyl = options.computedStyleSupportsPseudoElements, computedStyleSupportsPseudoElements = _options$computedStyl === void 0 ? options.getComputedStyle !== void 0 : _options$computedStyl, _options$getComputedS = options.getComputedStyle, uncachedGetComputedStyle = _options$getComputedS === void 0 ? window.getComputedStyle.bind(window) : _options$getComputedS, _options$hidden = options.hidden, hidden = _options$hidden === void 0 ? false : _options$hidden;
		var getComputedStyle = function getComputedStyle(el, pseudoElement) {
			if (pseudoElement !== void 0) throw new Error("use uncachedGetComputedStyle directly for pseudo elements");
			if (computedStyles === void 0) return uncachedGetComputedStyle(el);
			var cachedStyles = computedStyles.get(el);
			if (cachedStyles) return cachedStyles;
			var style = uncachedGetComputedStyle(el, pseudoElement);
			computedStyles.set(el, style);
			return style;
		};
		function computeMiscTextAlternative(node, context) {
			var accumulatedText = "";
			if (isElement(node) && computedStyleSupportsPseudoElements) {
				var beforeContent = getTextualContent(uncachedGetComputedStyle(node, "::before"));
				accumulatedText = "".concat(beforeContent, " ").concat(accumulatedText);
			}
			(isHTMLSlotElement(node) ? getSlotContents(node) : arrayFrom(node.childNodes).concat(queryIdRefs(node, "aria-owns"))).forEach(function(child) {
				var result = computeTextAlternative(child, {
					isEmbeddedInLabel: context.isEmbeddedInLabel,
					isReferenced: false,
					recursion: true
				});
				var separator = (isElement(child) ? getComputedStyle(child).getPropertyValue("display") : "inline") !== "inline" ? " " : "";
				accumulatedText += "".concat(separator).concat(result).concat(separator);
			});
			if (isElement(node) && computedStyleSupportsPseudoElements) {
				var afterContent = getTextualContent(uncachedGetComputedStyle(node, "::after"));
				accumulatedText = "".concat(accumulatedText, " ").concat(afterContent);
			}
			return accumulatedText.trim();
		}
		/**
		*
		* @param element
		* @param attributeName
		* @returns A string non-empty string or `null`
		*/
		function useAttribute(element, attributeName) {
			var attribute = element.getAttributeNode(attributeName);
			if (attribute !== null && !consultedNodes.has(attribute) && attribute.value.trim() !== "") {
				consultedNodes.add(attribute);
				return attribute.value;
			}
			return null;
		}
		function computeTooltipAttributeValue(node) {
			if (!isElement(node)) return null;
			return useAttribute(node, "title");
		}
		function computeElementTextAlternative(node) {
			if (!isElement(node)) return null;
			if (isHTMLFieldSetElement(node)) {
				consultedNodes.add(node);
				var children = arrayFrom(node.childNodes);
				for (var i = 0; i < children.length; i += 1) {
					var child = children[i];
					if (isHTMLLegendElement(child)) return computeTextAlternative(child, {
						isEmbeddedInLabel: false,
						isReferenced: false,
						recursion: false
					});
				}
			} else if (isHTMLTableElement(node)) {
				consultedNodes.add(node);
				var _children = arrayFrom(node.childNodes);
				for (var _i = 0; _i < _children.length; _i += 1) {
					var _child = _children[_i];
					if (isHTMLTableCaptionElement(_child)) return computeTextAlternative(_child, {
						isEmbeddedInLabel: false,
						isReferenced: false,
						recursion: false
					});
				}
			} else if (isSVGSVGElement(node)) {
				consultedNodes.add(node);
				var _children2 = arrayFrom(node.childNodes);
				for (var _i2 = 0; _i2 < _children2.length; _i2 += 1) {
					var _child2 = _children2[_i2];
					if (isSVGTitleElement(_child2)) return _child2.textContent;
				}
				return null;
			} else if (getLocalName(node) === "img" || getLocalName(node) === "area") {
				var nameFromAlt = useAttribute(node, "alt");
				if (nameFromAlt !== null) return nameFromAlt;
			} else if (isHTMLOptGroupElement(node)) {
				var nameFromLabel = useAttribute(node, "label");
				if (nameFromLabel !== null) return nameFromLabel;
			}
			if (isHTMLInputElement(node) && (node.type === "button" || node.type === "submit" || node.type === "reset")) {
				var nameFromValue = useAttribute(node, "value");
				if (nameFromValue !== null) return nameFromValue;
				if (node.type === "submit") return "Submit";
				if (node.type === "reset") return "Reset";
			}
			var labels = getLabels(node);
			if (labels !== null && labels.length !== 0) {
				consultedNodes.add(node);
				return arrayFrom(labels).map(function(element) {
					return computeTextAlternative(element, {
						isEmbeddedInLabel: true,
						isReferenced: false,
						recursion: true
					});
				}).filter(function(label) {
					return label.length > 0;
				}).join(" ");
			}
			if (isHTMLInputElement(node) && node.type === "image") {
				var _nameFromAlt = useAttribute(node, "alt");
				if (_nameFromAlt !== null) return _nameFromAlt;
				var nameFromTitle = useAttribute(node, "title");
				if (nameFromTitle !== null) return nameFromTitle;
				return "Submit Query";
			}
			if (hasAnyConcreteRoles(node, ["button"])) {
				var nameFromSubTree = computeMiscTextAlternative(node, {
					isEmbeddedInLabel: false,
					isReferenced: false
				});
				if (nameFromSubTree !== "") return nameFromSubTree;
			}
			return null;
		}
		function computeTextAlternative(current, context) {
			if (consultedNodes.has(current)) return "";
			if (!hidden && isHidden(current, getComputedStyle) && !context.isReferenced) {
				consultedNodes.add(current);
				return "";
			}
			var labelAttributeNode = isElement(current) ? current.getAttributeNode("aria-labelledby") : null;
			var labelElements = labelAttributeNode !== null && !consultedNodes.has(labelAttributeNode) ? queryIdRefs(current, "aria-labelledby") : [];
			if (compute === "name" && !context.isReferenced && labelElements.length > 0) {
				consultedNodes.add(labelAttributeNode);
				return labelElements.map(function(element) {
					return computeTextAlternative(element, {
						isEmbeddedInLabel: context.isEmbeddedInLabel,
						isReferenced: true,
						recursion: false
					});
				}).join(" ");
			}
			var skipToStep2E = context.recursion && isControl(current) && compute === "name";
			if (!skipToStep2E) {
				var ariaLabel = (isElement(current) && current.getAttribute("aria-label") || "").trim();
				if (ariaLabel !== "" && compute === "name") {
					consultedNodes.add(current);
					return ariaLabel;
				}
				if (!isMarkedPresentational(current)) {
					var elementTextAlternative = computeElementTextAlternative(current);
					if (elementTextAlternative !== null) {
						consultedNodes.add(current);
						return elementTextAlternative;
					}
				}
			}
			if (hasAnyConcreteRoles(current, ["menu"])) {
				consultedNodes.add(current);
				return "";
			}
			if (skipToStep2E || context.isEmbeddedInLabel || context.isReferenced) {
				if (hasAnyConcreteRoles(current, ["combobox", "listbox"])) {
					consultedNodes.add(current);
					var selectedOptions = querySelectedOptions(current);
					if (selectedOptions.length === 0) return isHTMLInputElement(current) ? current.value : "";
					return arrayFrom(selectedOptions).map(function(selectedOption) {
						return computeTextAlternative(selectedOption, {
							isEmbeddedInLabel: context.isEmbeddedInLabel,
							isReferenced: false,
							recursion: true
						});
					}).join(" ");
				}
				if (hasAbstractRole(current, "range")) {
					consultedNodes.add(current);
					if (current.hasAttribute("aria-valuetext")) return current.getAttribute("aria-valuetext");
					if (current.hasAttribute("aria-valuenow")) return current.getAttribute("aria-valuenow");
					return current.getAttribute("value") || "";
				}
				if (hasAnyConcreteRoles(current, ["textbox"])) {
					consultedNodes.add(current);
					return getValueOfTextbox(current);
				}
			}
			if (allowsNameFromContent(current) || isElement(current) && context.isReferenced || isNativeHostLanguageTextAlternativeElement(current) || isDescendantOfNativeHostLanguageTextAlternativeElement(current)) {
				var accumulatedText2F = computeMiscTextAlternative(current, {
					isEmbeddedInLabel: context.isEmbeddedInLabel,
					isReferenced: false
				});
				if (accumulatedText2F !== "") {
					consultedNodes.add(current);
					return accumulatedText2F;
				}
			}
			if (current.nodeType === current.TEXT_NODE) {
				consultedNodes.add(current);
				return current.textContent || "";
			}
			if (context.recursion) {
				consultedNodes.add(current);
				return computeMiscTextAlternative(current, {
					isEmbeddedInLabel: context.isEmbeddedInLabel,
					isReferenced: false
				});
			}
			var tooltipAttributeValue = computeTooltipAttributeValue(current);
			if (tooltipAttributeValue !== null) {
				consultedNodes.add(current);
				return tooltipAttributeValue;
			}
			consultedNodes.add(current);
			return "";
		}
		return asFlatString(computeTextAlternative(root, {
			isEmbeddedInLabel: false,
			isReferenced: compute === "description",
			recursion: false
		}));
	}
	//#endregion
	//#region package/dist/accessible-description.mjs
	function _typeof(o) {
		"@babel/helpers - typeof";
		return _typeof = "function" == typeof Symbol && "symbol" == typeof Symbol.iterator ? function(o) {
			return typeof o;
		} : function(o) {
			return o && "function" == typeof Symbol && o.constructor === Symbol && o !== Symbol.prototype ? "symbol" : typeof o;
		}, _typeof(o);
	}
	function ownKeys(e, r) {
		var t = Object.keys(e);
		if (Object.getOwnPropertySymbols) {
			var o = Object.getOwnPropertySymbols(e);
			r && (o = o.filter(function(r) {
				return Object.getOwnPropertyDescriptor(e, r).enumerable;
			})), t.push.apply(t, o);
		}
		return t;
	}
	function _objectSpread(e) {
		for (var r = 1; r < arguments.length; r++) {
			var t = null != arguments[r] ? arguments[r] : {};
			r % 2 ? ownKeys(Object(t), !0).forEach(function(r) {
				_defineProperty(e, r, t[r]);
			}) : Object.getOwnPropertyDescriptors ? Object.defineProperties(e, Object.getOwnPropertyDescriptors(t)) : ownKeys(Object(t)).forEach(function(r) {
				Object.defineProperty(e, r, Object.getOwnPropertyDescriptor(t, r));
			});
		}
		return e;
	}
	function _defineProperty(obj, key, value) {
		key = _toPropertyKey(key);
		if (key in obj) Object.defineProperty(obj, key, {
			value,
			enumerable: true,
			configurable: true,
			writable: true
		});
		else obj[key] = value;
		return obj;
	}
	function _toPropertyKey(t) {
		var i = _toPrimitive(t, "string");
		return "symbol" == _typeof(i) ? i : i + "";
	}
	function _toPrimitive(t, r) {
		if ("object" != _typeof(t) || !t) return t;
		var e = t[Symbol.toPrimitive];
		if (void 0 !== e) {
			var i = e.call(t, r || "default");
			if ("object" != _typeof(i)) return i;
			throw new TypeError("@@toPrimitive must return a primitive value.");
		}
		return ("string" === r ? String : Number)(t);
	}
	/**
	* @param root
	* @param options
	* @returns
	*/
	function computeAccessibleDescription(root) {
		var options = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
		var description = queryIdRefs(root, "aria-describedby").map(function(element) {
			return computeTextAlternative(element, _objectSpread(_objectSpread({}, options), {}, { compute: "description" }));
		}).join(" ");
		if (description === "") {
			var ariaDescription = root.getAttribute("aria-description");
			description = ariaDescription === null ? "" : ariaDescription;
		}
		if (description === "") {
			var title = root.getAttribute("title");
			description = title === null ? "" : title;
		}
		return description;
	}
	//#endregion
	//#region package/dist/accessible-name.mjs
	/**
	* https://w3c.github.io/aria/#namefromprohibited
	*/
	function prohibitsNaming(node) {
		return hasAnyConcreteRoles(node, [
			"caption",
			"code",
			"deletion",
			"emphasis",
			"generic",
			"insertion",
			"none",
			"paragraph",
			"presentation",
			"strong",
			"subscript",
			"superscript"
		]);
	}
	/**
	* implements https://w3c.github.io/accname/#mapping_additional_nd_name
	* @param root
	* @param options
	* @returns
	*/
	function computeAccessibleName(root) {
		var options = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
		if (prohibitsNaming(root)) return "";
		return computeTextAlternative(root, options);
	}
	//#endregion
	//#region package/dist/is-inaccessible.mjs
	/**
	* Partial implementation https://www.w3.org/TR/wai-aria-1.2/#tree_exclusion
	* which should only be used for elements with a non-presentational role i.e.
	* `role="none"` and `role="presentation"` will not be excluded.
	*
	* Implements aria-hidden semantics (i.e. parent overrides child)
	* Ignores "Child Presentational: True" characteristics
	*
	* @param element
	* @param options
	* @returns {boolean} true if excluded, otherwise false
	*/
	function isInaccessible(element) {
		var _element$ownerDocumen;
		var options = arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {};
		var _options$getComputedS = options.getComputedStyle, getComputedStyle = _options$getComputedS === void 0 ? (_element$ownerDocumen = element.ownerDocument.defaultView) === null || _element$ownerDocumen === void 0 ? void 0 : _element$ownerDocumen.getComputedStyle : _options$getComputedS, _options$isSubtreeIna = options.isSubtreeInaccessible, isSubtreeInaccessibleImpl = _options$isSubtreeIna === void 0 ? isSubtreeInaccessible : _options$isSubtreeIna;
		if (typeof getComputedStyle !== "function") throw new TypeError("Owner document of the element needs to have an associated window.");
		if (getComputedStyle(element).visibility === "hidden") return true;
		var currentElement = element;
		while (currentElement) {
			if (isSubtreeInaccessibleImpl(currentElement, { getComputedStyle })) return true;
			currentElement = currentElement.parentElement;
		}
		return false;
	}
	/**
	*
	* @param element
	* @param options
	* @returns {boolean} - `true` if every child of the element is inaccessible
	*/
	function isSubtreeInaccessible(element) {
		var _element$ownerDocumen2;
		var _options$getComputedS2 = (arguments.length > 1 && arguments[1] !== void 0 ? arguments[1] : {}).getComputedStyle, getComputedStyle = _options$getComputedS2 === void 0 ? (_element$ownerDocumen2 = element.ownerDocument.defaultView) === null || _element$ownerDocumen2 === void 0 ? void 0 : _element$ownerDocumen2.getComputedStyle : _options$getComputedS2;
		if (typeof getComputedStyle !== "function") throw new TypeError("Owner document of the element needs to have an associated window.");
		if (element.hidden === true) return true;
		if (element.getAttribute("aria-hidden") === "true") return true;
		if (getComputedStyle(element).display === "none") return true;
		return false;
	}
	//#endregion
	//#region package/dist/is-disabled.mjs
	var elementsSupportingDisabledAttribute = new Set([
		"button",
		"fieldset",
		"input",
		"optgroup",
		"option",
		"select",
		"textarea"
	]);
	/**
	* Check if an element is disabled
	* https://www.w3.org/TR/html-aam-1.0/#html-attribute-state-and-property-mappings
	* https://www.w3.org/TR/wai-aria-1.1/#aria-disabled
	*
	* @param element
	* @returns {boolean} true if disabled, otherwise false
	*/
	function isDisabled(element) {
		var localName = getLocalName(element);
		return elementsSupportingDisabledAttribute.has(localName) && element.hasAttribute("disabled") ? true : element.getAttribute("aria-disabled") === "true";
	}
	//#endregion
	exports.computeAccessibleDescription = computeAccessibleDescription;
	exports.computeAccessibleName = computeAccessibleName;
	exports.getRole = getRole;
	exports.isDisabled = isDisabled;
	exports.isInaccessible = isInaccessible;
	exports.isSubtreeInaccessible = isSubtreeInaccessible;
	return exports;
})({});
