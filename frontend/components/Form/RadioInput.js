import { useState } from "react";

import PropTypes from "prop-types";

import {
  Radio,
  RadioGroup,
  FormControlLabel,
  FormHelperText,
  Tooltip,
  Typography,
  Box,
} from "@mui/material";

const RadioInput = (props) => {
  const { id, name, helperText, options, row, register, error, defVal } = props;
  const [hovering, setHovering] = useState(false);
  const [focused, setFocused] = useState(false);

  // react-hook-form v7: register once and attach the field to every <Radio>;
  // MUI chains a Radio's own onChange with the surrounding RadioGroup's.
  const field = register ? register(name) : null;

  return (
    <Tooltip
      title={<Typography variant="subtitle2">{helperText}</Typography>}
      placement="right"
      arrow
      open={hovering || focused}
    >
      <RadioGroup
        id={id}
        name={name}
        style={{ width: "max-content" }}
        row={row}
        onFocus={() => setFocused(true)}
        onBlur={(e) => setFocused(false)}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        onChange={(e) => setFocused(false)}
        defaultValue={defVal || ""}
      >
        {options.map((option) => {
          return (
            <FormControlLabel
              key={option.value}
              value={option.value}
              control={
                <Radio
                  color="primary"
                  name={field ? field.name : name}
                  inputRef={field ? field.ref : undefined}
                  onChange={field ? field.onChange : undefined}
                  onBlur={field ? field.onBlur : undefined}
                />
              }
              label={
                <Typography color="secondary">
                  <Box component="span" sx={{ fontWeight: "bold" }}>
                    {option.label}
                  </Box>
                </Typography>
              }
            />
          );
        })}
        {error && (
          <FormHelperText style={{ color: "#f44336" }}>
            {error.message}
          </FormHelperText>
        )}
      </RadioGroup>
    </Tooltip>
  );
};

RadioInput.defaultProps = {
  helperText: "",
  row: false,
};

RadioInput.protoTypes = {
  id: PropTypes.string.isRequired,
  name: PropTypes.string.isRequired,
  helperText: PropTypes.string.isRequired,
  options: PropTypes.array.isRequired,
  register: PropTypes.func.isRequired,
  row: PropTypes.bool,
  defVal: PropTypes.string,
  error: PropTypes.object,
};

export default RadioInput;
