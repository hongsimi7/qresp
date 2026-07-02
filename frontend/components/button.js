import PropTypes from "prop-types";
import Link from "next/link";
import { Button } from "@mui/material";
import { styled } from "@mui/material/styles";

const StyledButton = styled(Button)({
  backgroundColor: "#800000",
  fontSize: "18px",
  color: "#FFF",
  "&:hover": {
    backgroundColor: "#B30000",
    borderColor: "#800000",
  },
  "&.Mui-disabled": {
    backgroundColor: "#bdc3c7",
    borderColor: "#800000",
    textDecoration: "line-through",
  },
});

const SmallStyledButton = styled(Button)({
  backgroundColor: "#800000",
  fontSize: "12px",
  margin: "4px",
  color: "#FFF",
  "&:hover": {
    backgroundColor: "#9a0000",
  },
});

const RegularStyledButton = styled(Button)({
  backgroundColor: "#800000",
  color: "#FFF",
  "&:hover": {
    backgroundColor: "#9a0000",
  },
  "&.Mui-disabled": {
    backgroundColor: "#bdc3c7",
    borderColor: "#800000",
  },
});

const ExternalStyledButton = (props) => {
  const { text, url } = props;

  return (
    <StyledButton
      variant="text"
      color="inherit"
      size="large"
      href={url}
      target="_blank"
      rel="noopener"
    >
      {text}
    </StyledButton>
  );
};

const InternalStyledButton = (props) => {
  const { text, url } = props;

  // Next 13+ <Link> renders its own <a>; render the Link as the Button root
  // instead of nesting a button inside an anchor.
  return (
    <StyledButton
      component={Link}
      href={url}
      variant="text"
      color="inherit"
      size="large"
    >
      {text}
    </StyledButton>
  );
};

ExternalStyledButton.propTypes = {
  text: PropTypes.string.isRequired,
  url: PropTypes.string.isRequired,
};

InternalStyledButton.propTypes = {
  text: PropTypes.string.isRequired,
  url: PropTypes.string.isRequired,
};

export {
  InternalStyledButton,
  ExternalStyledButton,
  SmallStyledButton,
  RegularStyledButton,
};
export default StyledButton;
