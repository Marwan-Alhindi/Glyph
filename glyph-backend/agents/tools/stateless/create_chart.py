import io
import json
import uuid

from langchain_core.tools import tool

from database.storage import StorageRepository


@tool
def create_chart(
    chart_type: str,
    title: str,
    data: str,
    x_label: str = "",
    y_label: str = "",
) -> str:
    """Generate a chart image and return a download URL.

    chart_type: 'bar', 'line', 'pie', or 'scatter'
    title: chart title
    data: JSON string with keys:
      - 'labels': list of strings (x-axis or pie slice names)
      - 'series': list of objects with 'name' (str) and 'values' (list of numbers)
      Example: {"labels": ["Q1","Q2","Q3"], "series": [{"name": "Revenue", "values": [10,20,15]}]}
    x_label: x-axis label (ignored for pie)
    y_label: y-axis label (ignored for pie)
    """
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        return "matplotlib is not installed on this server."

    try:
        spec = json.loads(data)
        labels = spec.get("labels", [])
        series = spec.get("series", [])
    except json.JSONDecodeError as e:
        return f"Invalid data JSON: {e}"

    fig, ax = plt.subplots(figsize=(8, 5))
    ax.set_title(title)

    try:
        if chart_type == "pie":
            values = series[0]["values"] if series else []
            ax.pie(values, labels=labels, autopct="%1.1f%%", startangle=90)
            ax.axis("equal")
        elif chart_type == "bar":
            x = range(len(labels))
            for i, s in enumerate(series):
                offset = [v + i * 0.8 / max(len(series), 1) for v in x]
                ax.bar(offset, s["values"], width=0.8 / max(len(series), 1), label=s.get("name", ""))
            ax.set_xticks(list(x))
            ax.set_xticklabels(labels)
            if len(series) > 1:
                ax.legend()
            if x_label:
                ax.set_xlabel(x_label)
            if y_label:
                ax.set_ylabel(y_label)
        elif chart_type == "line":
            for s in series:
                ax.plot(labels, s["values"], marker="o", label=s.get("name", ""))
            if len(series) > 1:
                ax.legend()
            if x_label:
                ax.set_xlabel(x_label)
            if y_label:
                ax.set_ylabel(y_label)
        elif chart_type == "scatter":
            for s in series:
                vals = s["values"]
                if vals and isinstance(vals[0], (list, tuple)):
                    xs, ys = zip(*vals)
                else:
                    xs, ys = range(len(vals)), vals
                ax.scatter(xs, ys, label=s.get("name", ""))
            if len(series) > 1:
                ax.legend()
            if x_label:
                ax.set_xlabel(x_label)
            if y_label:
                ax.set_ylabel(y_label)
        else:
            return f"Unknown chart_type '{chart_type}'. Use bar, line, pie, or scatter."
    except Exception as e:
        plt.close(fig)
        return f"Chart rendering error: {e}"

    try:
        fig.tight_layout()
        buf = io.BytesIO()
        fig.savefig(buf, format="png", dpi=120, bbox_inches="tight")
        buf.seek(0)
    except Exception as e:
        return f"Failed to render chart: {e}"
    finally:
        plt.close(fig)

    try:
        filename = f"charts/chart-{uuid.uuid4().hex[:8]}.png"
        url = StorageRepository().upload(filename, buf.read(), "image/png")
    except Exception as e:
        return f"Failed to upload chart: {e}"

    return f"Chart created. Include EXACTLY this in your reply so it renders inline:\n\n![{title}]({url})\n\n[Download {title}]({url})"
