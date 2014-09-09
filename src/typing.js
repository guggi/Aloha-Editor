/**
 * typing.js is part of Aloha Editor project http://aloha-editor.org
 *
 * Aloha Editor is a WYSIWYG HTML5 inline editing library and editor.
 * Copyright (c) 2010-2014 Gentics Software GmbH, Vienna, Austria.
 * Contributors http://aloha-editor.org/contribution.php
 */
define([
	'dom',
	'keys',
	'html',
	'undo',
	'events',
	'arrays',
	'editing',
	'strings',
	'metaview',
	'mutation',
	'selections',
	'traversing',
	'boundaries',
	'overrides',
	'functions'
], function (
	Dom,
	Keys,
	Html,
	Undo,
	Events,
	Arrays,
	Editing,
	Strings,
	Metaview,
	Mutation,
	Selections,
	Traversing,
	Boundaries,
	Overrides,
	Fn
) {
	'use strict';

	function undoable(type, event, fn) {
		var range = Boundaries.range(
			event.selection.boundaries[0],
			event.selection.boundaries[1]
		);
		Undo.capture(event.editable.undoContext, {
			meta: {type: type},
			oldRange: range
		}, function () {
			range = fn();
			return {newRange: range};
		});
	}

	/**
	 * Removes unrendered containers from each of the given boundaries while
	 * preserving the correct position of all.
	 *
	 * Returns a new set of boundaries that represent the corrected positions
	 * following node-removal. The order of the returned list corresponds with
	 * the list of boundaries that was given.
	 *
	 * @private
	 * @param  {Array.<Boundary>} boundaries
	 * @return {Array.<Boundary>}
	 */
	function removeUnrenderedContainers(boundaries) {
		function remove (node) {
			boundaries = Mutation.removeNode(node, boundaries);
		}
		for (var i = 0; i < boundaries.length; i++) {
			Dom.climbUntil(Boundaries.container(boundaries[i]), remove, Html.isRendered);
		}
		return boundaries;
	}

	function remove(direction, event) {
		var selection = event.selection;
		var start = selection.boundaries[0];
		var end = selection.boundaries[1];
		if (Boundaries.equals(start, end)) {
			if (direction) {
				end = Traversing.next(end);
			} else {
				start = Traversing.prev(start);
			}
		}
		var boundaries = Editing.remove(
			start,
			Traversing.envelopeInvisibleCharacters(end)
		);
		selection.formatting = Overrides.joinToSet(
			selection.formatting,
			Overrides.harvest(Boundaries.container(boundaries[0]))
		);
		boundaries = removeUnrenderedContainers(boundaries);
		Html.prop(Boundaries.commonContainer(boundaries[0], boundaries[1]));
		return boundaries;
	}

	function format(style, event) {
		var selection = event.selection;
		var boundaries = selection.boundaries;
		if (!Html.isBoundariesEqual(boundaries[0], boundaries[1])) {
			return Editing.toggle(boundaries[0], boundaries[1], style);
		}
		var override = Overrides.nodeToState[style];
		if (!override) {
			return boundaries;
		}
		var overrides = Overrides.joinToSet(
			selection.formatting,
			Overrides.harvest(Boundaries.container(boundaries[0])),
			selection.overrides
		);
		selection.overrides = Overrides.toggle(overrides, override, true);
		return selection.boundaries;
	}

	function breakline(isLinebreak, event) {
		if (!isLinebreak) {
			event.selection.formatting = Overrides.joinToSet(
				event.selection.formatting,
				Overrides.harvest(Boundaries.container(event.selection.boundaries[0]))
			);
		}
		var breaker = (event.meta.indexOf('shift') > -1)
		            ? 'BR'
		            : event.editable.settings.defaultBlock;
		return Editing.breakline(event.selection.boundaries[1], breaker);
	}

	function insertText(event) {
		var editable = event.editable;
		var selection = event.selection;
		var text = String.fromCharCode(event.keycode);
		var boundary = selection.boundaries[0];
		if ('\t' === text) {
			text = '\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0';
		}
		if (' ' === text) {
			var whiteSpaceStyle = Dom.getComputedStyle(
				Dom.upWhile(Boundaries.container(boundary), Dom.isTextNode),
				'white-space'
			);
			if (!Html.isWhiteSpacePreserveStyle(whiteSpaceStyle)) {
				text = '\xa0';
			}
		}
		boundary = Overrides.consume(boundary, Overrides.joinToSet(
			selection.formatting,
			selection.overrides
		));
		selection.overrides = [];
		selection.formatting = [];
		var range = Boundaries.range(boundary, boundary);
		var insertPath = Undo.pathFromBoundary(editable.elem, boundary);
		var insertContent = [editable.elem.ownerDocument.createTextNode(text)];
		var change = Undo.makeInsertChange(insertPath, insertContent);
		Undo.capture(editable.undoContext, {noObserve: true}, function () {
			Mutation.insertTextAtBoundary(text, boundary, true, [range]);
			return {changes: [change]};
		});
		return Boundaries.fromRange(range);
	}

	function toggleUndo(op, event) {
		var range = Boundaries.range(
			event.selection.boundaries[0],
			event.selection.boundaries[1]
		);
		op(event.editable.undoContext, range, [range]);
		return Boundaries.fromRange(range);
	}

	function selectEditable(event) {
		var editable = Dom.editingHost(Boundaries.commonContainer(
			event.selection.boundaries[0],
			event.selection.boundaries[1]
		));
		return !editable ? event.selection.boundaries : [
			Boundaries.create(editable, 0),
			Boundaries.fromEndOfNode(editable)
		];
	}

	/**
	 * Whether or not the given event represents a text input.
	 *
	 * @see
	 * https://lists.webkit.org/pipermail/webkit-dev/2007-December/002992.html
	 *
	 * @private
	 * @param  {AlohaEvent} event
	 * @return {boolean}
	 */
	function isTextInput(event) {
		return 'keypress' === event.type
		    && 'alt' !== event.meta
			&& 'ctrl' !== event.meta
		    && !Strings.isControlCharacter(String.fromCharCode(event.keycode));
	}

	var deleteBackward = {
		clearOverrides : true,
		preventDefault : true,
		undo           : 'delete',
		mutate         : Fn.partial(remove, false)
	};

	var deleteForward = {
		clearOverrides : true,
		preventDefault : true,
		undo           : 'delete',
		mutate         : Fn.partial(remove, true)
	};

	var breakBlock = {
		removeContent  : true,
		preventDefault : true,
		undo           : 'enter',
		mutate         : Fn.partial(breakline, false)
	};

	var breakLine = {
		removeContent  : true,
		preventDefault : true,
		undo           : 'enter',
		mutate         : Fn.partial(breakline, true)
	};

	var formatBold = {
		preventDefault : true,
		undo           : 'bold',
		mutate         : Fn.partial(format, 'B')
	};

	var formatItalic = {
		preventDefault : true,
		undo           : 'italic',
		mutate         : Fn.partial(format, 'I')
	};

	var formatUnderline = {
		preventDefault : true,
		undo           : 'underline',
		mutate         : Fn.partial(format, 'U')
	};

	var inputText = {
		removeContent  : true,
		preventDefault : true,
		undo           : 'typing',
		mutate         : insertText
	};

	var selectAll = {
		preventDefault : true,
		clearOverrides : true,
		mutate         : selectEditable
	};

	var undo = {
		clearOverrides : true,
		preventDefault : true,
		mutate         : Fn.partial(toggleUndo, Undo.undo)
	};

	var redo = {
		preventDefault : true,
		clearOverrides : true,
		mutate         : Fn.partial(toggleUndo, Undo.redo)
	};

	var actions = {
		'breakBlock'     : breakBlock,
		'breakLine'      : breakLine,
		'deleteBackward' : deleteBackward,
		'deleteForward'  : deleteForward,
		'formatBold'     : formatBold,
		'formatItalic'   : formatItalic,
		'inputText'      : inputText,
		'redo'           : redo,
		'undo'           : undo
	};

	var handlers = {
		'keydown'  : {},
		'keypress' : {},
		'keyup'    : {}
	};

	handlers['keydown'][Keys.CODES['up']] =
	handlers['keydown'][Keys.CODES['down']] =
	handlers['keydown'][Keys.CODES['left']] =
	handlers['keydown'][Keys.CODES['right']] = {clearOverrides: true};

	handlers['keydown'][Keys.CODES['delete']] = deleteForward;
	handlers['keydown'][Keys.CODES['backspace']] = deleteBackward;
	handlers['keydown'][Keys.CODES['enter']] = breakBlock;
	handlers['keydown']['shift+' + Keys.CODES['enter']] = breakLine;
	handlers['keydown']['ctrl+b'] =
	handlers['keydown']['meta+b'] = formatBold;
	handlers['keydown']['ctrl+i'] =
	handlers['keydown']['meta+i'] = formatItalic;
	handlers['keydown']['ctrl+u'] =
	handlers['keydown']['meta+u'] = formatUnderline;
	handlers['keydown']['ctrl+a'] =
	handlers['keydown']['meta+a'] = selectAll;
	handlers['keydown']['ctrl+z'] =
	handlers['keydown']['meta+z'] = undo;
	handlers['keydown']['ctrl+shift+z'] =
	handlers['keydown']['meta+shift+z'] = redo;
	handlers['keydown'][Keys.CODES['tab']] = inputText;

	handlers['keypress']['input'] = inputText;

	handlers['keydown']['ctrl+0'] = {mutate : function toggleUndo(event) {
		if (event.editable) {
			Metaview.toggle(event.editable.elem);
		}
		return event.selection.boundaries;
	}};

	handlers['keydown']['ctrl+1'] = {mutate : function toggleUndo(event) {
		if (event.editable) {
			Metaview.toggle(event.editable.elem, {
				'outline': true,
				'tagname': true
			});
		}
		return event.selection.boundaries;
	}};

	handlers['keydown']['ctrl+2'] = {mutate : function toggleUndo(event) {
		if (event.editable) {
			Metaview.toggle(event.editable.elem, {
				'outline': true,
				'tagname': true,
				'padding': true
			});
		}
		return event.selection.boundaries;
	}};

	function handler(event) {
		return Keys.shortcutHandler(event, handlers)
		    || (isTextInput(event) && handlers['keypress']['input']);
	}

	/**
	 * Updates selection and nativeEvent
	 */
	function handleTyping(event) {
		var selection = event.selection;
		var start = selection.boundaries[0];
		var end = selection.boundaries[1];
		/*
		if (!event.editable) {
			if ('keydown' === event.type) {
				if (Dom.isEditableNode(Boundaries.container(start))
				 || Dom.isEditableNode(Boundaries.container(end))) {
					Events.preventDefault(event.nativeEvent);
				}
			}
			return event;
		}
		*/
		var handling = handler(event);
		if (!handling) {
			return event;
		}
		if (handling.preventDefault) {
			Events.preventDefault(event.nativeEvent);
		}
		if (handling.clearOverrides) {
			selection.overrides = [];
			selection.formatting = [];
		}
		if (handling.mutate) {
			if (handling.undo) {
				undoable(handling.undo, event, function () {
					if (handling.removeContent && !Boundaries.equals(start, end)) {
						selection.boundaries = remove(false, event);
					}
					selection.boundaries = handling.mutate(event);
					Html.prop(Boundaries.commonContainer(
						selection.boundaries[0],
						selection.boundaries[1]
					));
				});
			} else {
				selection.boundaries = handling.mutate(event);
			}
		}
		return event;
	}

	return {
		handleTyping  : handleTyping,
		actions       : actions
	};
});
