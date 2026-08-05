import { Fragment, useState } from "react";
import PropTypes from "prop-types";

import { TextField, Typography, Tooltip } from "@mui/material";

const TextInput = (props) => {
  const {
    helperText = "",
    id,
    label,
    error,
    register,
    registerOptions,
    type = "text",
    ...rest
  } = props;

  // react-hook-form v7: register(name, options) returns
  // { name, ref, onChange, onBlur }. MUI's TextField forwards `ref` to its
  // root element, so the field ref goes to `inputRef` (the real <input>), and
  // onBlur is chained into this component's own InputProps.onBlur below.
  // Callers pass `register={register}` (v6 passed `inputRef={register}`).
  const field = register ? register(props.name, registerOptions) : null;

  // const [field, meta] = useField(props);
  const [focused, setFocused] = useState(false);
  const [hovering, setHovering] = useState(false);
  return (
    <Tooltip
      title={
        helperText ? (
          <Typography variant="subtitle2">{helperText}</Typography>
        ) : (
          ""
        )
      }
      placement="top"
      arrow
      open={focused || hovering}
    >
      <TextField
        {...rest}
        type={type}
        {...(field
          ? { name: field.name, onChange: field.onChange, inputRef: field.ref }
          : {})}
        fullWidth
        variant="outlined"
        // The error stays while the field has focus. Save now sends the
        // curator straight to the first invalid field, and a message that
        // vanished on arrival — along with aria-invalid and the
        // aria-describedby that names it — left them looking at a field with
        // no reason on it. It clears the moment the value becomes valid.
        error={Boolean(error)}
        helperText={error ? error.message : ""}
        InputProps={{
          onFocus: () => setFocused(true),
          onBlur: (e) => {
            setFocused(false);
            if (field) field.onBlur(e);
          },
          onMouseEnter: () => setHovering(true),
          onMouseLeave: () => setHovering(false),
          id: id,
        }}
        label={label}
      />
    </Tooltip>
  );
};

TextInput.propTypes = {
  id: PropTypes.string.isRequired,
  placeholder: PropTypes.string.isRequired,
  name: PropTypes.string.isRequired,
  type: PropTypes.string,
  helperText: PropTypes.string,
  label: PropTypes.string,
};

export default TextInput;
