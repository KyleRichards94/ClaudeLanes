import { useId, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from 'react';
import {
  Platform,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextInputInstance,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { color, focusRing, minTarget, radius, space } from '@agent-lanes/tokens';
import { Icon } from './Icon';
import { Text, textStyle } from './Text';

/**
 * - `text`: one line (Organisation URL).
 * - `multiline`: a resizable box for prose ("What should the agent do?").
 * - `secure`: a token or API key: masked, no autocomplete or spellcheck, and the value never
 *   leaves the field except through its handle's `read()` / `take()` (see `SecureTextFieldHandle`).
 * - `search`: one line with a leading search icon ("Search by ID or title").
 */
export type TextFieldVariant = 'text' | 'multiline' | 'secure' | 'search';

/** What every TextField's `ref` exposes. */
export interface TextFieldHandle {
  focus(): void;
  blur(): void;
}

/**
 * A secure field keeps its secret to itself: there is no `value` prop and no `onChangeText`, so
 * the secret can't end up in a parent's state, a store, a log or the DOM's attributes by accident.
 * The form reaches it through this handle, once, when it submits.
 */
export interface SecureTextFieldHandle extends TextFieldHandle {
  /** The secret as typed, left in place, for a step that needs it again later (Test connection). */
  read(): string;
  /**
   * Hands the secret over and clears it from the field's state. Call it from the form's submit
   * (Save), and send the result straight on; the field is empty afterwards, whatever the save does.
   */
  take(): string;
  /** Empties the field without reading it (Cancel). */
  clear(): void;
}

/** A field needs an accessible name: a visible `label`, or `aria-label` when the design has none. */
type FieldName = { label: string; 'aria-label'?: undefined } | { label?: undefined; 'aria-label': string };

interface FieldBaseProps {
  /** Help under the field, e.g. which PAT scopes are needed. Linked with `aria-describedby`. */
  help?: string;
  /**
   * What is wrong with the value. Shows a red outline and an alert icon with the text (status is
   * never colour alone), sets `aria-invalid`, and is linked with `aria-describedby`.
   */
  error?: string | null;
  placeholder?: string;
  /** Greyed and not editable ("Default project · Loaded after the token is tested"). */
  disabled?: boolean;
  required?: boolean;
  autoFocus?: boolean;
  maxLength?: number;
  /**
   * A control beside the input box, on the same line, such as "Test connection" next to the
   * PAT on artboard 5. Label, help and error stay aligned with the box.
   */
  accessory?: ReactNode;
  /** Enter in a single-line field. Focus stays in the field. Not called by multiline fields. */
  onSubmitEditing?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  /** Layout extras for the whole field (width, margins). */
  style?: StyleProp<ViewStyle>;
  /** Set on the input element, the part tests type into. */
  testID?: string;
}

interface ValueProps {
  value?: string;
  defaultValue?: string;
  onChangeText?: (text: string) => void;
}

interface SingleLineProps extends FieldBaseProps, ValueProps {
  variant?: 'text' | 'search';
  inputMode?: TextInputProps['inputMode'];
  autoComplete?: TextInputProps['autoComplete'];
  ref?: Ref<TextFieldHandle>;
}

interface MultilineProps extends FieldBaseProps, ValueProps {
  variant: 'multiline';
  /** Visible lines before the box scrolls; the user can drag it taller. Defaults to 5. */
  rows?: number;
  ref?: Ref<TextFieldHandle>;
}

interface SecureProps extends FieldBaseProps {
  variant: 'secure';
  /**
   * Called after every edit with whether the field holds anything, so the form can enable its
   * buttons or reset a passed test. Never receives the secret.
   */
  onSecretChange?: (filled: boolean) => void;
  ref?: Ref<SecureTextFieldHandle>;
  value?: never;
  defaultValue?: never;
  onChangeText?: never;
}

export type TextFieldProps = (SingleLineProps | MultilineProps | SecureProps) & FieldName;

/** Read off artboards 2 and 5: 46 px boxes (44 inside a 1 px line), 12 px inset, 16 px icon. */
const inset = space.md;
const iconSize = 16;
const valueText = textStyle('body');
const lineHeight = valueText.lineHeight ?? 20;
const multilineInset = 14;
const defaultRows = 5;

/**
 * Label, input box, error and help text (design §11, artboards 2 and 5). Focus shows the violet
 * ring around the whole box, search icon included. Label, help and error are tied to the input
 * for screen readers with `aria-labelledby` and `aria-describedby`.
 */
export function TextField({ ref, ...props }: TextFieldProps) {
  const { label, help, error, disabled = false, accessory, style } = props;
  const variant: TextFieldVariant = props.variant ?? 'text';
  const id = useId();
  const labelId = `${id}label`;
  const helpId = `${id}help`;
  const errorId = `${id}error`;
  const [focused, setFocused] = useState(false);
  const invalid = Boolean(error);
  const describedBy = [invalid ? errorId : null, help ? helpId : null].filter(Boolean).join(' ');

  const common: CommonInputProps = {
    // Spread rather than set as attributes: React Native's types don't list these web ARIA props,
    // and react-native-web renders them on the <input>.
    aria: {
      'aria-labelledby': label ? labelId : undefined,
      'aria-label': label ? undefined : props['aria-label'],
      'aria-describedby': describedBy || undefined,
      'aria-invalid': invalid || undefined,
      'aria-required': props.required || undefined,
      'aria-disabled': disabled || undefined,
    },
    editable: !disabled,
    placeholder: props.placeholder,
    placeholderTextColor: color.muted,
    autoFocus: props.autoFocus,
    maxLength: props.maxLength,
    testID: props.testID,
    onFocus: () => {
      setFocused(true);
      props.onFocus?.();
    },
    onBlur: () => {
      setFocused(false);
      props.onBlur?.();
    },
    style: [
      styles.input,
      variant === 'multiline' ? styles.multilineInput : styles.singleLineInput,
      disabled && styles.disabledInput,
      noNativeOutline,
    ],
  };
  const onSubmitEditing = props.onSubmitEditing;
  const submit: SubmitProps = {
    onSubmitEditing: onSubmitEditing ? () => onSubmitEditing() : undefined,
    // Enter submits without moving focus away (react-native-web reads blurOnSubmit).
    submitBehavior: 'submit',
    blurOnSubmit: false,
  };

  let input: ReactNode;
  if (props.variant === 'secure') {
    input = (
      <SecureInput
        common={common}
        submit={submit}
        // The variant picks the handle: secure props declare a SecureTextFieldHandle ref.
        handleRef={ref as Ref<SecureTextFieldHandle> | undefined}
        onSecretChange={props.onSecretChange}
      />
    );
  } else if (props.variant === 'multiline') {
    input = (
      <PlainInput
        common={common}
        handleRef={ref as Ref<TextFieldHandle> | undefined}
        value={props.value}
        defaultValue={props.defaultValue}
        onChangeText={props.onChangeText}
        multiline
        rows={props.rows ?? defaultRows}
      />
    );
  } else {
    input = (
      <PlainInput
        common={common}
        submit={submit}
        handleRef={ref as Ref<TextFieldHandle> | undefined}
        value={props.value}
        defaultValue={props.defaultValue}
        onChangeText={props.onChangeText}
        inputMode={props.inputMode}
        autoComplete={props.autoComplete}
        role={variant === 'search' ? 'searchbox' : undefined}
        enterKeyHint={variant === 'search' ? 'search' : undefined}
      />
    );
  }

  return (
    <View style={[styles.field, style]}>
      {label ? (
        <Text id={labelId} variant="title">
          {label}
        </Text>
      ) : null}
      <View style={styles.row}>
        <View
          style={[
            styles.box,
            disabled && styles.disabledBox,
            invalid && styles.invalidBox,
            focused && styles.focusedBox,
          ]}
        >
          {variant === 'search' ? <Icon name="search" size={iconSize} color={color.muted} style={styles.leadingIcon} /> : null}
          {input}
        </View>
        {accessory}
      </View>
      {invalid ? (
        <View style={styles.message}>
          <Icon name="alert" size={14} color={color.danger} />
          <Text id={errorId} variant="meta" color={color.danger} style={styles.messageText}>
            {error}
          </Text>
        </View>
      ) : null}
      {help ? (
        <Text id={helpId} variant="meta">
          {help}
        </Text>
      ) : null}
    </View>
  );
}

/** Web ARIA props React Native's types leave out; react-native-web renders them on the <input>. */
interface AriaProps {
  'aria-labelledby'?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  'aria-required'?: boolean;
  'aria-disabled'?: boolean;
}

interface CommonInputProps {
  aria: AriaProps;
  editable: boolean;
  placeholder?: string;
  placeholderTextColor: string;
  autoFocus?: boolean;
  maxLength?: number;
  testID?: string;
  onFocus: () => void;
  onBlur: () => void;
  style: StyleProp<TextStyle>;
}

type SubmitProps = Pick<TextInputProps, 'onSubmitEditing' | 'submitBehavior' | 'blurOnSubmit'>;

interface PlainInputProps extends ValueProps {
  common: CommonInputProps;
  submit?: SubmitProps;
  handleRef: Ref<TextFieldHandle> | undefined;
  multiline?: boolean;
  rows?: number;
  inputMode?: TextInputProps['inputMode'];
  autoComplete?: TextInputProps['autoComplete'];
  role?: TextInputProps['role'];
  enterKeyHint?: TextInputProps['enterKeyHint'];
}

function PlainInput({ common, submit, handleRef, multiline = false, rows, ...input }: PlainInputProps) {
  const { aria, ...inputProps } = common;
  const inputRef = useRef<TextInputInstance>(null);
  useImperativeHandle(
    handleRef,
    () => ({
      focus: () => inputRef.current?.focus(),
      blur: () => inputRef.current?.blur(),
    }),
    [],
  );

  return (
    <TextInput
      {...aria}
      {...inputProps}
      {...submit}
      {...input}
      ref={inputRef}
      multiline={multiline}
      rows={rows}
      style={[inputProps.style, multiline && rows !== undefined ? { minHeight: rows * lineHeight + 2 * multilineInset } : null]}
    />
  );
}

interface SecureInputProps {
  common: CommonInputProps;
  submit: SubmitProps;
  handleRef: Ref<SecureTextFieldHandle> | undefined;
  onSecretChange?: (filled: boolean) => void;
}

/**
 * Holds the secret in one ref and the input's own live value, nowhere else.
 *
 * The input is deliberately uncontrolled: React mirrors a controlled input's `value` into the
 * DOM `value` attribute, which would put the token in the markup (devtools, any outerHTML dump).
 * A ref rather than state also leaves no stale copy in React's previous render: emptying it
 * empties the only copy.
 */
function SecureInput({ common, submit, handleRef, onSecretChange }: SecureInputProps) {
  const { aria, ...inputProps } = common;
  const secret = useRef('');
  const inputRef = useRef<TextInputInstance>(null);

  const change = (next: string) => {
    secret.current = next;
    onSecretChange?.(next.length > 0);
  };

  useImperativeHandle(handleRef, () => {
    const empty = () => {
      const held = secret.current !== '';
      secret.current = '';
      inputRef.current?.clear();
      if (held) onSecretChange?.(false);
    };
    return {
      focus: () => inputRef.current?.focus(),
      blur: () => inputRef.current?.blur(),
      read: () => secret.current,
      take: () => {
        const taken = secret.current;
        empty();
        return taken;
      },
      clear: empty,
    };
  }, [onSecretChange]);

  return (
    <TextInput
      {...aria}
      {...inputProps}
      {...submit}
      ref={inputRef}
      onChangeText={change}
      secureTextEntry
      autoComplete="off"
      autoCorrect={false}
      autoCapitalize="none"
      spellCheck={false}
    />
  );
}

/**
 * The box draws the focus ring, so the input inside it drops the global `:focus-visible` outline.
 * A plain object, not StyleSheet.create: react-native-web renders it inline, which beats the
 * stylesheet rule whatever the CSS order.
 */
const noNativeOutline: TextStyle = { outlineWidth: 0 };

/** react-native-web passes `resize` to the <textarea>; artboard 2 shows the drag handle. */
const verticalResize = Platform.OS === 'web' ? { resize: 'vertical' } : {};

const styles = StyleSheet.create({
  field: {
    rowGap: space.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: space.sm,
  },
  box: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: minTarget + 2,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.control,
  },
  disabledBox: {
    backgroundColor: color.bg,
  },
  invalidBox: {
    borderColor: color.danger,
  },
  focusedBox: {
    outlineColor: focusRing.color,
    outlineStyle: 'solid',
    outlineWidth: focusRing.width,
    outlineOffset: focusRing.offset,
  },
  leadingIcon: {
    marginLeft: inset,
  },
  input: {
    ...valueText,
    flex: 1,
    minWidth: 0,
    alignSelf: 'stretch',
    borderRadius: radius.control,
  },
  singleLineInput: {
    minHeight: minTarget,
    paddingHorizontal: inset,
  },
  multilineInput: {
    padding: multilineInset,
    textAlignVertical: 'top',
    ...verticalResize,
  },
  disabledInput: {
    color: color.muted,
  },
  message: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: space.xs,
  },
  messageText: {
    flexShrink: 1,
  },
});
