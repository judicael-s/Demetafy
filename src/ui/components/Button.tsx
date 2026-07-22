import { splitProps, type Component, type JSX } from "solid-js";
import {
  buttonClasses,
  type ButtonVariant,
  type ControlSize,
} from "../lib/presentation";

export type ButtonProps = JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ControlSize;
  class?: string;
};

const Button: Component<ButtonProps> = (props) => {
  const [local, rest] = splitProps(props, ["variant", "size", "class", "type"]);

  return (
    <button
      type={local.type ?? "button"}
      class={[buttonClasses(local.variant ?? "secondary", local.size ?? "md"), local.class]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    />
  );
};

export default Button;
