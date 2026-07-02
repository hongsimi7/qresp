import { createElement, useState, useEffect, useRef } from "react";
import PropTypes from "prop-types";

import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableRow,
  Grid,
} from "@mui/material";
import { styled } from "@mui/material/styles";

import { CSSTransition, TransitionGroup } from "react-transition-group";

import RowsPerPageSelector from "./RowsPerPageSelector";
import EnhancedTableHeader from "./TableHeader";
import EnhancedTableFooter from "./TableFooter";
import TableSearch, { TableSearchState } from "./TableSearch";
import { getComparator, stableSort } from "./TableSort";

const StyledTableCell = styled(TableCell)({
  padding: "8px",
});

const StyledLastTableCell = styled(TableCell)({
  padding: "8px",
  borderBottomColor: "#000",
});

// React 19 removed findDOMNode, which CSSTransition falls back to when no
// nodeRef is supplied; each animated row therefore owns its ref here.
const FadeTableRow = ({ children, ...transitionProps }) => {
  const nodeRef = useRef(null);
  return (
    <CSSTransition {...transitionProps} nodeRef={nodeRef}>
      <TableRow ref={nodeRef}>{children}</TableRow>
    </CSSTransition>
  );
};

FadeTableRow.propTypes = {
  children: PropTypes.node,
};

const RecordTable = (props) => {
  const { rows, columns } = props;

  // Scroll to Top of Table
  const tableRef = useRef(null);

  // Pagination Controls
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  const handleChangePage = (event, newPage) => {
    setPage(newPage);
    window.scrollTo(
      0,
      tableRef.current.getBoundingClientRect().top + window.pageYOffset - 96
    );
  };

  const handleChangeRowsPerPage = (event) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  // Sorting Controls
  const [order, setOrder] = useState("desc");
  const [orderBy, setOrderBy] = useState("");

  const handleRequestSort = (event, property) => {
    const isAsc = orderBy === property && order === "asc";
    setOrder(isAsc ? "desc" : "asc");
    setOrderBy(property);
  };

  // Search/Filter Controls
  const [filtered, setFiltered] = useState(rows);

  useEffect(() => {
    setFiltered(rows);
    setPage(0);
  }, [rows]);

  useEffect(() => {
    setPage(0);
  }, [filtered]);

  // Sorted Data
  const sortedData =
    orderBy.length > 0
      ? stableSort(filtered, getComparator(order, orderBy, columns), orderBy)
      : filtered;

  // Paginating
  const paginatedData = sortedData.slice(
    page * rowsPerPage,
    page * rowsPerPage + rowsPerPage
  );

  return (
    <TableSearchState>
      <Grid container direction="row" alignItems="center" ref={tableRef}>
        <Grid item xs={12} sm={6}>
          <RowsPerPageSelector
            count={rows.length}
            rowsPerPage={rowsPerPage}
            onChangeRowsPerPage={handleChangeRowsPerPage}
          />
        </Grid>
        <Grid item xs={12} sm={6}>
          <TableSearch
            columns={columns}
            setFiltered={setFiltered}
            rows={rows}
          />
        </Grid>
      </Grid>
      <TableContainer>
        <Table>
          <EnhancedTableHeader
            headers={columns}
            order={order}
            orderBy={orderBy}
            onRequestSort={handleRequestSort}
          />
          <TableBody>
            <TransitionGroup component={null}>
              {paginatedData.map((row, index) => {
                return (
                  <FadeTableRow timeout={100} key={index} classNames="fade">
                    {columns.map((col, i) => {
                      const element = col.view
                        ? createElement(col.view, { rowdata: row[col.name] })
                        : row[col.name];

                      return index == paginatedData.length - 1 ? (
                        <StyledLastTableCell key={i} align={col.options.align}>
                          {element}
                        </StyledLastTableCell>
                      ) : (
                        <StyledTableCell key={i} align={col.options.align}>
                          {element}
                        </StyledTableCell>
                      );
                    })}
                  </FadeTableRow>
                );
              })}
            </TransitionGroup>
          </TableBody>
        </Table>
      </TableContainer>
      <EnhancedTableFooter
        rows={rows.length}
        filtered={filtered.length}
        rowsPerPage={rowsPerPage}
        page={page}
        onChangePage={handleChangePage}
      />
    </TableSearchState>
  );
};

RecordTable.propTypes = {
  columns: PropTypes.array.isRequired,
  rows: PropTypes.array.isRequired,
};

export default RecordTable;
